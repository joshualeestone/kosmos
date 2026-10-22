'use strict';

/**
 * #6214: stopping a running account move. Driven with its dependencies stated, as accountmove-6173.test.js is: what is
 * asserted is what a stop does with each agent (already restarted, mid-restart, not reached), what the person reads,
 * that a hand change made since the move is kept (Liu Kang m5659), and that nothing is left held.
 *
 * #6231 item 7: the put-backs no longer run inside stop() on the board's thread. stop() flags the move and ANSWERS AT
 * ONCE; each not-reached agent is put back on its old account in the move's own async tail (start's finally), OFF the
 * board's thread, through deps.putBackAsync, and stays HELD until its own put-back settles. So a not-reached agent reads
 * as `pending` in the stop answer and gets its final sentence on a later read() once the batch settles; the move stays
 * running (busy() true, so Update and a board restart stay refused) until the last put-back settles. These tests drive
 * that: they await `out.done` before reading the finals, and a `slow` put-back lets them observe the move still running,
 * and the agent still held, mid-put-back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const accountmove = require('./accountmove');

const REFUSED = 'refused-by-create';
const RESTARTED = 'restarted-by-remove';

/* Each agent's saved account lives in `saved`; setAccount and the put-back write it, readAccount reads it.
   #6231 item 7: the board wires putBackAsync (win32: removal.putBackAsync; linux/mac: Promise.resolve(create.restoreAccount)),
   and the engine's async tail awaits it. `slow` holds a put-back open until the test calls d.settlePutBack(name), so a
   test can observe the move still running (busy) and the agent still held while its put-back is in flight. `putBacks`
   records each write in order; `noted` records deps.leftOnOld (the #6174 note), covered in depth by accountmove-notes-6231. */
function deps({ saved = {}, putBackRefuses = [], unreadable = [], slow = [] } = {}) {
  const pending = new Map(), order = [], held = new Set(), putBacks = [], noted = [], slowGate = new Map();
  const names = { '/acct/old': 'old@example.com', '/acct/new': 'new@example.com', '/acct/other': 'other@example.com', '/acct/default': 'default@example.com' };
  const write = (n, dir) => {
    putBacks.push([n, dir]);
    if (putBackRefuses.includes(n)) return { outcome: REFUSED, because: 'that account is signed out' };
    saved[n] = dir;
    return { outcome: 'changed', account: { email: dir === null ? 'default@example.com' : names[dir] } };
  };
  return {
    pending, order, held, putBacks, noted, saved, slowGate,
    settlePutBack: (n) => { const g = slowGate.get(n); if (g) { slowGate.delete(n); g(); } },
    moveRefusal: () => null,   // #6190: nothing else holds these agents
    hold: (ns) => ns.forEach((n) => held.add(n)),
    release: (n) => held.delete(n),
    /* A move to '/acct/default' models the default account: setAccount writes its job configDir as null (readAccount then
       reads back null, i.e. `job.configDir || null`) while the returned account still carries a concrete dir plus isDefault.
       setAccount REPORTS the configDir it wrote (#6231 item 8); the engine caches that value for the per-agent `to` read. */
    setAccount: (n, dir) => { const isDefault = dir === '/acct/default'; const configDir = isDefault ? null : dir; saved[n] = configDir; return { outcome: 'changed', configDir, account: { email: names[dir], dir, isDefault } }; },
    readAccount: (n) => { if (unreadable.includes(n)) throw new Error('unreadable'); return n in saved ? saved[n] : null; },
    /* The async put-back the move's tail awaits. A `slow` agent's put-back parks until the test settles it. */
    putBackAsync: (n, dir) => {
      if (slow.includes(n)) return new Promise((resolve) => slowGate.set(n, () => resolve(write(n, dir))));
      return Promise.resolve(write(n, dir));
    },
    putBack: (n, dir) => write(n, dir),   // the sync seam; the async tail uses putBackAsync
    REFUSED,
    forget: () => {},
    restartAsync: (n) => { order.push(n); return new Promise((resolve) => pending.set(n, resolve)); },
    RESTARTED,
    leftOnOld: (n) => { noted.push(n); },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test.afterEach(() => accountmove.resetForTests());

test('#6214: a stop keeps the restarted result, lets the one mid-restart finish, and puts the rest back (in the tail)', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old', di: null } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy', 'di'] }, d);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick();
  assert.deepEqual(d.order, ['al', 'bo'], 'bo is mid-restart');

  const s = accountmove.stop();
  assert.equal(s.status, 200);
  assert.equal(s.body.stopped, true);
  assert.equal(s.body.waitingFor, 'bo', 'the answer names the agent whose restart finishes first');
  /* #6231 item 7: the stop answers at once; the not-reached agents are still pending here, put back off the thread. */
  assert.deepEqual(s.body.agents.map((a) => [a.name, a.outcome]),
    [['al', 'changed'], ['bo', 'pending'], ['cy', 'pending'], ['di', 'pending']]);
  assert.deepEqual(d.putBacks, [], 'no put-back has run yet: they happen in the async tail, after the answer');
  assert.deepEqual([...d.held].sort(), ['bo', 'cy', 'di'], 'the not-reached stay held until their own put-back settles (contract 3b); only the already-restarted al is released');
  assert.equal(accountmove.busy(), true, 'the move still runs: the restart under way, then the put-backs');

  d.pending.get('bo')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.order, ['al', 'bo'], 'nothing after the stop is restarted');
  assert.deepEqual(d.putBacks, [['cy', '/acct/old'], ['di', null]], 'only the unreached are put back, the default account as null');
  assert.equal(d.saved.cy, '/acct/old');
  assert.equal(d.saved.di, null);

  const end = accountmove.read(out.body.id);
  assert.equal(end.done, true);
  assert.equal(end.stopped, true);
  assert.equal(end.waitingFor, undefined, 'a finished move waits for nobody');
  assert.deepEqual(end.agents.map((a) => a.outcome), ['changed', 'changed', 'stopped', 'stopped'], 'the mid-restart one ends as its restart said; the rest are put back');
  assert.equal(end.agents[2].because, 'you stopped the move before their turn. They stay on old@example.com.');
  assert.equal(end.agents[3].because, 'you stopped the move before their turn. They stay on default@example.com.');
  assert.equal(end.agents[2].account, undefined, 'a put-back agent does not carry the new account');
  assert.equal(d.held.size, 0, 'nothing is left held');
  assert.equal(accountmove.busy(), false, 'the board is released');
});

test('#6231 item 8: a move TO the default account still puts the not-reached agents back; the cached `to` is normalized to null (not the resolved dir), so the clobber guard does not spuriously fire', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old', di: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/default', names: ['al', 'bo', 'cy', 'di'] }, d);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick();
  assert.deepEqual(d.order, ['al', 'bo'], 'bo is mid-restart; cy and di are not reached');

  const s = accountmove.stop();
  assert.equal(s.body.stopped, true);
  assert.equal(d.saved.al, null, 'al was moved to the default account, whose job reads back as null (configDir || null)');

  d.pending.get('bo')({ outcome: RESTARTED, steps: [] });
  await out.done;

  /* The cached `to` for cy and di comes from the configDir setAccount reported: null for this default account, exactly what
     readAccount returns (`job.configDir || null`). So at put-back now (null) === a.to.dir (null): the clobber guard passes
     and both are put back to their old account. Had `to` cached the resolved account dir instead, now !== a.to.dir would be
     (null !== '/acct/default') on every stop, falsely reading "changed since" and skipping every put-back. That is the
     item-8 trap this test guards. */
  assert.deepEqual(d.putBacks, [['cy', '/acct/old'], ['di', '/acct/old']], 'the not-reached agents are put back, not skipped as "changed since"');
  assert.equal(d.saved.cy, '/acct/old');
  assert.equal(d.saved.di, '/acct/old');
  assert.deepEqual(d.noted, [], 'no spurious leftOnOld note: the default-account `to` did not trip the clobber guard');

  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => [a.name, a.outcome]), [['al', 'changed'], ['bo', 'changed'], ['cy', 'stopped'], ['di', 'stopped']]);
});

test('#6231 item 8 (Codex/CODEX_HOME trap): a move to a DEFAULT account that still writes a CONCRETE configDir puts the not-reached agents back; the cache uses the written configDir, not `isDefault ? null`', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' } });
  /* Model a Codex agent moved to its default account WITH CODEX_HOME in force: create.setCodexAccount writes
     configDir = acct.isDefault && !codexHomeOverridden() ? null : acct.dir, so the DEFAULT here writes a CONCRETE dir,
     not null, and readAccount reads that concrete dir back. setAccount reports exactly that written configDir. */
  const CODEX_HOME = '/acct/codexhome';
  d.setAccount = (n) => { d.saved[n] = CODEX_HOME; return { outcome: 'changed', configDir: CODEX_HOME, account: { email: 'codex-default@example.com', dir: CODEX_HOME, isDefault: true } }; };
  const out = accountmove.start({ dir: '/acct/codexdefault', names: ['al', 'bo', 'cy'] }, d);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick();
  const s = accountmove.stop();
  assert.equal(s.body.stopped, true);
  assert.equal(d.saved.al, CODEX_HOME, 'al was moved: its job reads back the concrete CODEX_HOME, not null');

  d.pending.get('bo')({ outcome: RESTARTED, steps: [] });
  await out.done;

  /* cy was not reached. Its cached `to.dir` is the written configDir (CODEX_HOME), which equals readAccount at put-back,
     so now === a.to.dir and cy is put back. An `isDefault ? null` shortcut would cache null, and null !== CODEX_HOME would
     falsely read "changed since" and skip the put-back -- exactly the Codex-override trap. */
  assert.deepEqual(d.putBacks, [['cy', '/acct/old']], 'the not-reached Codex-default agent is put back, not skipped as "changed since"');
  assert.equal(d.saved.cy, '/acct/old');
  assert.deepEqual(d.noted, [], 'no spurious leftOnOld note');
});

test('#6231 item 8: when setAccount reports no configDir, the `to` read falls back to the live readAccount, so an unupdated path keeps correct put-back behavior', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' } });
  /* A setAccount that reports NO configDir (an older/unupdated runner path). savedTo must fall back to readNow(name),
     i.e. the live readAccount, so the put-back clobber guard still has a correct `to` to compare against. */
  d.setAccount = (n, dir) => { d.saved[n] = dir; return { outcome: 'changed', account: { email: 'x@example.com' } }; };
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy'] }, d);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick();
  accountmove.stop();
  d.pending.get('bo')({ outcome: RESTARTED, steps: [] });
  await out.done;

  /* cy not reached: its `to` came from the live read (readAccount right after the move = '/acct/new'), which still equals
     readAccount at put-back, so the guard passes and cy is put back. Had the fallback returned {ok:false}, the readiness
     gate would skip the put-back instead. */
  assert.deepEqual(d.putBacks, [['cy', '/acct/old']], 'the not-reached agent is put back via the live-read fallback');
  assert.equal(d.saved.cy, '/acct/old');
});

test('#6214 (Liu Kang m5659): an account changed by hand since the move saved it is kept, not put back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  d.saved.bo = '/acct/other';   // the person moved bo by hand while al restarted
  const s = accountmove.stop();
  assert.equal(s.body.agents[1].outcome, 'pending', '#6231 item 7: bo\'s final appears after the answer, from the tail');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.putBacks, [], 'no write over the hand change (the tail re-reads and leaves it alone)');
  assert.equal(d.saved.bo, '/acct/other');
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'stopped');
  assert.equal(bo.because, 'you stopped the move before their turn, and their account had been changed since the move saved it, so we left it as it is now.');
  assert.equal(d.held.size, 0);
  assert.equal(accountmove.busy(), false);
});

test('#6214: a hand change back to the default account is a change too (null is not the move\'s account)', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  d.saved.bo = null;
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.putBacks, [], 'the move does not write over a hand change back to the default account');
  assert.equal(d.saved.bo, null);
  assert.equal(accountmove.read(out.body.id).agents[1].outcome, 'stopped');
});

test('#6214: a put-back that is refused is said as saved and not restarted', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, putBackRefuses: ['bo'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  const s = accountmove.stop();
  assert.equal(s.body.agents[1].outcome, 'pending');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'partial');
  assert.equal(bo.because, 'We saved new@example.com, but you stopped the move before its turn and we could not put it back on its old account (that account is signed out). It is still on the old account until it restarts.');
  assert.equal(d.held.size, 0);
});

test('#6214: an agent whose account could not be read when the move saved it is not put back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, unreadable: ['bo'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  const s = accountmove.stop();
  assert.equal(s.body.agents[1].outcome, 'pending');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.putBacks, []);
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'partial');
  assert.match(bo.because, /we could not put it back on its old account \(we could not read which account it was on\)\./);
});

test('#6214: without readAccount (a caller that never wired it) a stop still ends the move and puts nothing back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  delete d.readAccount;
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.putBacks, []);
  assert.equal(accountmove.read(out.body.id).agents[1].outcome, 'partial');
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
  assert.deepEqual(d.putBacks, [], 'the second stop starts no put-back: none has run yet, they are in the tail');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.putBacks, [['bo', '/acct/old']], 'bo is put back once, in the tail');
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
  assert.deepEqual(d.putBacks, [['bo', '/acct/old'], ['cy', '/acct/old']]);
  assert.equal(d.held.size, 0);
});

test('#6214: the board wires the stop route, the strict account read, the sync + async put-back, and says a refusal can stop the move', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const routeAt = server.indexOf("pathname === '/api/agents/account' && req.method === 'POST'");
  assert.ok(routeAt > 0, 'the bulk move route is not in server.js');
  const route = server.slice(routeAt);
  const call = route.slice(0, route.indexOf('sendJson(res, started.status'));
  /* Strict: a job that cannot be read throws, so the put-back never takes an unreadable agent for one on the default
     account (moveFromDir folds that into null). */
  assert.match(call, /readAccount: \(n\) => \{\n\s+const job = create\.readJob\(create\.cleanName\(n\)\);\n\s+if \(!job\) throw new Error\('its launch job could not be read'\);\n\s+return job\.configDir \|\| null;\n\s+\},/,
    'the move cannot read an agent\'s account strictly');
  assert.match(call, /putBack: \(n, dir\) => create\.restoreAccount\(n, dir\),/, 'a stop cannot put an agent back, or puts it back through setAccount\'s destination checks');
  /* #6231 item 7: the async put-back the tail awaits -- win32 drives it off the board thread; linux/mac wrap the sync
     put-back in a resolved promise (already non-blocking). */
  assert.ok(call.includes('putBackAsync:'), 'the move wires an async put-back for the tail');
  assert.match(call, /removal\.putBackAsync\(n, dir\)/, 'win32 drives the async put-back off the board thread');
  assert.match(call, /Promise\.resolve\(create\.restoreAccount\(n, dir\)\)/, 'linux/mac wrap the sync put-back in a resolved promise');
  /* The stop route is matched before the read route, whose pattern would otherwise take "stop" for a move id (and as a
     GET it would not, but a later method change must not make it). */
  const stopAt = server.indexOf("if (pathname === '/api/agents/account-moves/stop' && req.method === 'POST') {");
  const readAt = server.indexOf('const acctMoveRead = pathname.match(');
  assert.ok(stopAt > 0, 'the stop route is not in server.js');
  assert.ok(readAt > stopAt, 'the stop route must come before the read route');
  assert.match(server.slice(stopAt, stopAt + 300), /const stopped = accountmove\.stop\(\);\n\s+sendJson\(res, stopped\.status, stopped\.body\);/);
  assert.match(server, /function moveStoppableNote\(\) \{ return accountmove\.busy\(\) \? \{ moveStoppable: true \} : \{\}; \}/);
  /* Every refusal for a held board says whether a stop would help, so each page can offer it. */
  // #6903: the two update routes answer through their logging `say(...)`; the other refusals through sendJson.
  const refusals = server.match(/if \((?:!isNoop && )?moveHoldsBoard\(\)\) \{ (?:sendJson\(res, |say\()409, \{[^\n]*\}\); return; \}/g) || [];
  assert.equal(refusals.length, 4, `expected the four board-restart refusals, found ${refusals.length}`);
  for (const r of refusals) assert.ok(r.includes('...moveStoppableNote()'), `a refusal does not offer the stop: ${r}`);
});

test('#6214: once a stopped move ends, nothing holds the board, so an Update is no longer refused for it', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  accountmove.stop();
  assert.equal(accountmove.busy(), true, 'still held while al finishes restarting');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.equal(accountmove.busy(), false, 'moveHoldsBoard reads busy(): false here is what lets Update through');
  assert.equal(d.held.size, 0, 'no agent is left held in the engine either');
});

test('#6214: a put-back whose account has no name the board can read says "their old account"', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/codex/old' } });
  d.putBackAsync = (n, dir) => { d.putBacks.push([n, dir]); d.saved[n] = dir; return Promise.resolve({ outcome: 'created', because: null, account: null }); };
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const bo = accountmove.read(out.body.id).agents[1];
  assert.equal(bo.outcome, 'stopped');
  assert.equal(bo.because, 'you stopped the move before their turn. They stay on their old account.');
});

test('#6214 with #6190: an agent the move refused because a restart still held it is left alone by a stop', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' } });
  d.moveRefusal = (n) => (n === 'bo' ? { because: 'Bo is still being restarted.' } : null);
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy'] }, d);
  assert.equal(d.saved.bo, '/acct/old', 'PRECONDITION: the refused agent was never written');
  const s = accountmove.stop();
  assert.deepEqual(s.body.agents.map((a) => [a.name, a.outcome]), [['al', 'pending'], ['bo', 'refused'], ['cy', 'pending']]);
  assert.equal(s.body.agents[1].because, 'Bo is still being restarted.', 'the refusal keeps its own sentence');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => [a.name, a.outcome]), [['al', 'changed'], ['bo', 'refused'], ['cy', 'stopped']]);
  assert.deepEqual(d.putBacks, [['cy', '/acct/old']], 'only the unreached agent the move wrote is put back');
  assert.equal(d.held.size, 0);
});

/* ------------------------------------------------------------------------------------------------------------------ *
 * #6231 item 7 contracts (Splinter's ruling, quoted on #6183): the put-backs run in the move's async tail, off the
 * board's thread, each agent held until its own put-back settles; the move stays running until the last settles.
 * ------------------------------------------------------------------------------------------------------------------ */

test('#6231 item 7 (contract 1): a slow put-back keeps the move running (busy) until it settles, so an Update stays refused', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, slow: ['bo'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  const s = accountmove.stop();
  assert.equal(s.body.agents[1].outcome, 'pending', 'bo is pending in the stop answer');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick(); await tick();
  assert.ok(d.slowGate.has('bo'), 'PRECONDITION: bo\'s put-back is parked in flight, not yet written');
  assert.deepEqual(d.putBacks, [], 'the put-back has not been written yet');
  assert.equal(accountmove.busy(), true, 'the move still runs while bo\'s put-back is in flight -- Update/board restart stay refused');
  assert.equal(accountmove.read(out.body.id).done, false, 'the move is not done until the last put-back settles');
  d.settlePutBack('bo');
  await out.done;
  assert.equal(accountmove.busy(), false, 'once the last put-back settles the move ends and Update is allowed through');
  assert.deepEqual(d.putBacks, [['bo', '/acct/old']]);
  assert.equal(accountmove.read(out.body.id).agents[1].outcome, 'stopped');
});

test('#6231 item 7 (contract 3b): a not-reached agent stays held until its own put-back settles, then is released', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, slow: ['bo'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick(); await tick();
  assert.ok(d.slowGate.has('bo'), 'PRECONDITION: bo\'s put-back is in flight');
  assert.equal(d.held.has('bo'), true, 'bo stays held while its put-back writes, so a same-agent switch is refused and cannot land over the put-back');
  d.settlePutBack('bo');
  await out.done;
  assert.equal(d.held.has('bo'), false, 'bo is released only after its own put-back settles');
  assert.equal(d.held.size, 0);
});

test('#6231 item 7 (contract 3): a hand change landing mid-batch is still detected for a not-yet-put-back agent', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' }, slow: ['bo'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy'] }, d);
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick(); await tick();
  assert.ok(d.slowGate.has('bo'), 'PRECONDITION: bo\'s put-back is parked, cy not reached yet');
  d.saved.cy = '/acct/other';   // the person moves cy by hand while bo's put-back is in flight
  d.settlePutBack('bo');
  await out.done;
  assert.deepEqual(d.putBacks, [['bo', '/acct/old']], 'bo is put back; cy is not written over');
  assert.equal(d.saved.cy, '/acct/other', 'cy keeps the hand change (the per-agent re-read stays atomic with its write)');
  const cy = accountmove.read(out.body.id).agents[2];
  assert.equal(cy.outcome, 'stopped');
  assert.match(cy.because, /their account had been changed since the move saved it/);
});

test('#6231 item 7: a caller that wired only the sync putBack (no putBackAsync) still puts back, run inline', async () => {
  // putBackBefore's canWrite accepts a sync-only putBack; putBackOne must then honour that by running it inline,
  // or canWrite would be a lie and the agent would be refused with "putBackAsync is not a function".
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  delete d.putBackAsync;
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.putBacks, [['bo', '/acct/old']], 'the put-back ran through the sync putBack');
  assert.equal(accountmove.read(out.body.id).agents[1].outcome, 'stopped');
  assert.equal(d.held.size, 0);
});

test('#6231 item 7 (contract 4): a second stop while the put-backs are still running is a no-op and says so', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, slow: ['bo'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  accountmove.stop();
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick(); await tick();
  assert.ok(d.slowGate.has('bo'), 'PRECONDITION: a put-back is in flight');
  const again = accountmove.stop();
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true, 'the second stop changes nothing and says the move is already stopping');
  assert.deepEqual(d.putBacks, [], 'it starts no extra put-back');
  d.settlePutBack('bo');
  await out.done;
  assert.deepEqual(d.putBacks, [['bo', '/acct/old']], 'bo is put back exactly once across both stops');
});
