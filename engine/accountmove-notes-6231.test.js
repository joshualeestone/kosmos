'use strict';

/**
 * #6231 items 9 and 10 (follow-up to #6214; item 9 covers a failed or thrown put-back, a hand change to a third account,
 * the move's time cap and its hold failing): an agent a move leaves saved on the new account while it still runs on its
 * old one (its put-back after a stop failed, or the move ended before it reached it) gets #6174's note through
 * deps.leftOnOld, as a partial restart does; and a caller with no putBack is told so in its own words. Driven with the
 * dependencies stated, as accountmove-stop-6214.test.js is.
 *
 * #6231 item 7: the put-backs now run in the move's async tail (through deps.putBackAsync), off the board's thread, so a
 * put-back's outcome -- and the note that follows a failed or hand-changed one -- appears during `out.done`, not in the
 * stop() answer. These tests await `out.done` before reading the notes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const accountmove = require('./accountmove');

const REFUSED = 'refused-by-create';
const RESTARTED = 'restarted-by-remove';

function deps({ saved = {}, putBackRefuses = [], noPutBack = false, noteThrows = false } = {}) {
  const pending = new Map(), noted = [];
  const write = (n, dir) => {
    if (putBackRefuses.includes(n)) return { outcome: REFUSED, because: 'that account is signed out' };
    saved[n] = dir;
    return { outcome: 'changed', account: { email: 'old@example.com' } };
  };
  const d = {
    pending, noted, saved,
    moveRefusal: () => null,
    hold: () => {},
    release: () => {},
    setAccount: (n, dir) => { saved[n] = dir; return { outcome: 'changed', account: { email: 'new@example.com', dir, isDefault: false } }; },
    readAccount: (n) => (n in saved ? saved[n] : null),
    /* #6231 item 7: the tail awaits putBackAsync. putBack is kept for the sync seam / any remaining sync caller. */
    putBackAsync: (n, dir) => Promise.resolve(write(n, dir)),
    putBack: (n, dir) => write(n, dir),
    REFUSED,
    forget: () => {},
    restartAsync: (n) => new Promise((resolve) => pending.set(n, resolve)),
    RESTARTED,
    leftOnOld: (n) => { noted.push(n); if (noteThrows) throw new Error('the note could not be written'); },
  };
  if (noPutBack) { delete d.putBack; delete d.putBackAsync; }
  return d;
}
const tick = () => new Promise((r) => setImmediate(r));

test.afterEach(() => accountmove.resetForTests());

test('#6231 item 9: a stop whose put-back fails notes the agent as still on its old account; a put-back that works does not', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' }, putBackRefuses: ['cy'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy'] }, d);
  await tick();   // al is mid-restart
  const s = accountmove.stop();
  /* #6231 item 7: the not-reached agents are still pending in the stop answer; their put-backs run in the tail. */
  assert.deepEqual(s.body.agents.map((a) => [a.name, a.outcome]), [['al', 'pending'], ['bo', 'pending'], ['cy', 'pending']]);
  assert.deepEqual(d.noted, [], 'nothing is noted yet: the put-backs have not run');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => [a.name, a.outcome]), [['al', 'changed'], ['bo', 'stopped'], ['cy', 'partial']]);
  assert.deepEqual(d.noted, ['cy'], 'only the agent whose put-back failed is noted; the one put back cleanly is not');
});

test('#6231 item 9: an agent changed by hand since the move is left as changed; noted unless the change put it back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy'] }, d);
  await tick();
  d.saved.bo = '/acct/other';   // a person pointed bo at a third account while al restarts: it still runs on old
  d.saved.cy = '/acct/old';     // and cy back on the old one: nothing left over
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['changed', 'stopped', 'stopped']);
  assert.equal(d.saved.bo, '/acct/other', 'the hand change was not overwritten');
  assert.deepEqual(d.noted, ['bo'], 'only the agent saved on another account and never restarted is noted');
});

test('#6231 item 9: a move that ends before reaching agents notes each of them', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  d.moveCapMs = 0;   // the move's time is up before its first restart
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['partial', 'partial']);
  assert.deepEqual(d.noted, ['al', 'bo'], 'each agent the move never reached is noted');
});

test('#6231 item 9: a note that throws does not change the move or its answer', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, putBackRefuses: ['bo'], noteThrows: true });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  const s = accountmove.stop();
  assert.equal(s.status, 200);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'partial');
  assert.match(bo.because, /could not put it back on its old account \(that account is signed out\)/);
  assert.equal(accountmove.busy(), false, 'the move still ended, the throwing note swallowed');
});

test('#6231 item 10: a caller with no putBack is told so in its own words, and the agent is noted', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, noPutBack: true });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'partial');
  assert.match(bo.because, /\(this Kosmos cannot put an agent back on its old account\)/);
  assert.doesNotMatch(bo.because, /could not read which account/, 'the missing put-back is its own message, not an unreadable account');
  assert.deepEqual(d.noted, ['bo']);
});

test('#6231 item 9: a move whose hold fails notes every agent it saved (none is restarted)', () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  d.hold = () => { throw new Error('the hold could not be taken'); };
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  assert.deepEqual(out.body.agents.map((a) => a.outcome), ['partial', 'partial']);
  assert.deepEqual(d.noted, ['al', 'bo'], 'each agent saved but never restarted is noted');
});

test('#6231 item 10: a caller with no readAccount is told so in its own words', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  delete d.readAccount;
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const bo = accountmove.read(out.body.id).agents[1];
  assert.match(bo.because, /\(this Kosmos cannot read which account an agent was on\)/);
});

test('#6231 item 9: a put-back whose ASYNC write rejects is said as partial and NOTED (deps carried through putBackOne\'s catch)', async () => {
  // Regression guard: putBackOne's catch must pass deps to putBackFailed, or leftOnOld is a no-op and the agent
  // is left saved-on-new / running-on-old with no note -- the exact #6174/#6231 note this feature exists to write.
  // The async REJECTION path is the one that matters: removal.putBackAsync rejects on any driver/generator error.
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  d.putBackAsync = () => Promise.reject(new Error('schtasks exploded'));
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'partial');
  assert.match(bo.because, /could not put it back on its old account \(schtasks exploded\)/);
  assert.deepEqual(d.noted, ['bo'], 'a rejected async put-back still notes the agent as left on its old account');
});

test('#6231 item 7: a put-back ABANDONED at its cap is worded as UNCONFIRMED (not "still on the old account"), and still noted', async () => {
  // The async cap resolves { capped: true }: whether the write landed is unknown (an in-flight /Create can land
  // after the cap fires). accountmove must not assert the saved/running state; it says "check Settings" and notes it.
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  d.putBackAsync = () => Promise.resolve({ outcome: REFUSED, capped: true, because: 'putting it back did not finish within 300 seconds, so we stopped waiting for it' });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'partial');
  assert.match(bo.because, /not confirmed -- check its account in Settings/);
  assert.doesNotMatch(bo.because, /still on the old account until it restarts/, 'the cap case must not falsely assert the saved/running state');
  assert.deepEqual(d.noted, ['bo'], 'an unconfirmed put-back is still noted (the safe side)');
});

test('#6231 item 9: a put-back that throws past its own guard is still said and noted', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  accountmove.stop();
  // the tail's putBackAfter reads deps.REFUSED after the write; make that read throw, so the throw leaves putBackOne
  // past its own catch and the move's belt-and-braces catch in the tail still says it and notes the agent.
  Object.defineProperty(d, 'REFUSED', { get() { throw new Error('unexpected'); }, configurable: true });
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  Object.defineProperty(d, 'REFUSED', { value: REFUSED, configurable: true });
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'partial');
  assert.match(bo.because, /could not put it back on its old account/);
  assert.deepEqual(d.noted, ['bo'], 'the tail\'s catch noted the agent');
});
