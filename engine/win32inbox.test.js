'use strict';
/**
 * #2042 S1: the fleet inbound poller's delivery brain.
 *
 * These arms drive engine/win32inbox.js entirely through its seams -- a fake live
 * roster, a fake owned set, a fake `say`, a fake win32live source -- so NO test
 * ever touches a real agent, pipe, board, store, or the Slack network. They pin the
 * things the poller must get right: which envelope is for a live local worker (W2),
 * what a delivery verdict means for the cursor (W4, no spool), and the round-2
 * message-loss fixes -- an owned-but-down worker BLOCKS rather than being lost
 * (FIX 2), and routing is by `to:` alone so a name-collision cannot drop legitimate
 * inbound (FIX 3).
 *
 *   node --test engine/win32inbox.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const win32inbox = require('./win32inbox');
const { DISPOSITION } = win32inbox;

/* An envelope in the fleet's grammar. */
function env({ from, to, body }) {
  return [
    '=== KOSMOS MSG ===',
    'from: ' + from,
    'to: ' + to,
    (body || 'do the thing'),
    '=== END KOSMOS MSG ===',
  ].join('\n');
}

/* A `say` that records its calls and answers a fixed verdict. */
function sayReturning(verdict) {
  const calls = [];
  const fn = (name, text) => { calls.push({ name, text }); return verdict; };
  fn.calls = calls;
  return fn;
}

/* runInbox with the two name-sets always injected, so a test never reads the real
   store. Owned defaults to empty; a test that exercises owned-but-down passes it. */
function run(messages, opts) {
  return win32inbox.runInbox({ messages }, Object.assign({ ownedNames: [] }, opts));
}

const LIVE = ['winstream-1', 'reh-a'];

// ── W1 parseEnvelope ─────────────────────────────────────────────────────────

test('parseEnvelope pulls from and a comma-listed to, stripping a trailing (annotation)', () => {
  const { from, toNames } = win32inbox.parseEnvelope(
    'from: mac-orchestrator\nto: winstream-1 (worker), reh-a\nhello',
  );
  assert.equal(from, 'mac-orchestrator');
  assert.deepEqual(toNames, ['winstream-1', 'reh-a']);
});

test('parseEnvelope on a malformed envelope (no to: line) yields no targets', () => {
  const { from, toNames } = win32inbox.parseEnvelope('just some chatter, no envelope here');
  assert.equal(from, null);
  assert.deepEqual(toNames, [], 'nothing can ever be delivered off an envelope with no to:');
});

// ── W2 resolveTarget ─────────────────────────────────────────────────────────

test('resolveTarget picks the matching name among several to-names', () => {
  assert.equal(win32inbox.resolveTarget(['nobody', 'reh-a', 'winstream-1'], LIVE), 'reh-a',
    'the FIRST to-name in the set wins');
});

test('resolveTarget returns null when no to-name is in the set', () => {
  assert.equal(win32inbox.resolveTarget(['ghost-agent'], LIVE), null);
  assert.equal(win32inbox.resolveTarget([], LIVE), null);
});

// ── ownedWorkerNames (FIX 2 source) ──────────────────────────────────────────

test('ownedWorkerNames = record names minus removed, flattened', () => {
  const owned = win32inbox.ownedWorkerNames({
    record: { read: () => ({
      s1: { name: 'reh-a' },
      s2: { name: 'reh-b' },
      s3: { name: 'gone-worker' },
      s4: { name: '   ' },            // no visible char -> excluded
    }) },
    isRemoved: (n) => n === 'gone-worker',
  });
  assert.deepEqual([...owned].sort(), ['reh-a', 'reh-b'], 'removed and degenerate names are excluded');
});

test('ownedWorkerNames is fail-safe empty when the record read throws', () => {
  const owned = win32inbox.ownedWorkerNames({
    record: { read: () => { throw new Error('boom'); } },
    isRemoved: () => false,
  });
  assert.equal(owned.size, 0);
});

// ── W4 verdictToDisposition: chat.js's three-way contract, verbatim ───────────

test('verdictToDisposition mirrors chat.js: placed advances, unconfirmed advances+logs, could_not does not', () => {
  const placed = win32inbox.verdictToDisposition({ ok: true });
  assert.deepEqual({ kind: placed.kind, advance: placed.advance }, { kind: DISPOSITION.PLACED, advance: true });

  const unconf = win32inbox.verdictToDisposition({ ok: false, unsure: true, because: 'lost the answer' });
  assert.equal(unconf.kind, DISPOSITION.UNCONFIRMED);
  assert.equal(unconf.advance, true);
  assert.equal(unconf.log, true, 'unconfirmed advances but must be logged');

  const could = win32inbox.verdictToDisposition({ ok: false, because: 'it is not running just now' });
  assert.equal(could.kind, DISPOSITION.COULD_NOT);
  assert.equal(could.advance, false, 'could_not must NOT advance -- the un-advanced cursor is the retry');
});

// ── runInbox: W1-W4 wired together, cursor decision ──────────────────────────

test('placed -> deliver and advance the cursor', () => {
  const say = sayReturning({ ok: true });
  const r = run([{ ts: '100.1', text: env({ from: 'mac-1', to: 'winstream-1', body: 'ping' }) }], { liveNames: LIVE, say });
  assert.equal(r.ok, true);
  assert.equal(r.advanceTo, '100.1', 'a placed message advances the cursor to its ts');
  assert.equal(say.calls.length, 1);
  assert.equal(say.calls[0].name, 'winstream-1', 'delivered to the resolved live worker');
  assert.equal(r.results[0].kind, DISPOSITION.PLACED);
});

test('unconfirmed -> advance the cursor and log it', () => {
  const say = sayReturning({ ok: false, unsure: true, because: 'no answer in time' });
  const r = run([{ ts: '200.2', text: env({ from: 'mac-1', to: 'reh-a' }) }], { liveNames: LIVE, say });
  assert.equal(r.advanceTo, '200.2', 'unconfirmed still advances (avoids a duplicate send)');
  assert.equal(r.results[0].kind, DISPOSITION.UNCONFIRMED);
  assert.ok(r.results[0].because, 'the reason is carried so the ps1 can log it');
});

test('could_not -> cursor UNMOVED and later messages are NOT processed this poll', () => {
  const say = sayReturning({ ok: false, because: 'it is not running just now' });
  const r = run([
    { ts: '300.1', text: env({ from: 'mac-1', to: 'winstream-1', body: 'down pipe' }) },
    { ts: '300.2', text: env({ from: 'mac-1', to: 'reh-a', body: 'later message' }) },
  ], { liveNames: LIVE, say });
  assert.equal(r.advanceTo, null, 'a could_not on the first message leaves the cursor before it -- that IS the retry');
  assert.equal(say.calls.length, 1, 'the walk STOPS at could_not; the later message is left for the next poll');
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].kind, DISPOSITION.COULD_NOT);
});

test('could_not after a placed keeps the cursor at the placed message, retries from the could_not', () => {
  let n = 0;
  const say = (name, text) => { n += 1; return n === 1 ? { ok: true } : { ok: false, because: 'down' }; };
  const r = run([
    { ts: '400.1', text: env({ from: 'mac-1', to: 'reh-a', body: 'delivered' }) },
    { ts: '400.2', text: env({ from: 'mac-1', to: 'winstream-1', body: 'blocked' }) },
  ], { liveNames: LIVE, say });
  assert.equal(r.advanceTo, '400.1', 'cursor sits on the last delivered message, before the could_not');
});

test('a name that is neither live nor owned is advanced past (not ours)', () => {
  const say = sayReturning({ ok: true });
  const r = run([{ ts: '500.9', text: env({ from: 'mac-1', to: 'some-remote-agent', body: 'not ours' }) }], { liveNames: LIVE, say });
  assert.equal(say.calls.length, 0, 'nothing typed');
  assert.equal(r.advanceTo, '500.9', 'a name we do not own is skipped, not retried forever');
  assert.equal(r.results[0].kind, DISPOSITION.NOT_LOCAL);
});

test('a malformed envelope is not delivered and is advanced past', () => {
  const say = sayReturning({ ok: true });
  const r = run([{ ts: '600.0', text: 'no envelope, no to: line, just noise' }], { liveNames: LIVE, say });
  assert.equal(say.calls.length, 0);
  assert.equal(r.advanceTo, '600.0');
  assert.equal(r.results[0].kind, DISPOSITION.NOT_LOCAL);
});

// ── FIX 2: owned-but-down worker BLOCKS, is not lost ──────────────────────────

test('FIX 2: a message to an OWNED-but-down worker BLOCKS (cursor unmoved), never advanced past', () => {
  const say = sayReturning({ ok: true });
  const r = run([
    { ts: '710.1', text: env({ from: 'mac-1', to: 'reh-b', body: 'to a crashed owned worker' }) },
    { ts: '710.2', text: env({ from: 'mac-1', to: 'reh-a', body: 'later' }) },
  ], { liveNames: LIVE, ownedNames: ['reh-a', 'reh-b'], say });
  // reh-b is owned but NOT in LIVE (crashed/restarting) -> owned_down -> block.
  assert.equal(r.results[0].kind, DISPOSITION.OWNED_DOWN);
  assert.equal(r.results[0].target, 'reh-b');
  assert.equal(r.advanceTo, null, 'the owned-but-down message is NOT advanced past -- it is retried when the worker restarts');
  assert.equal(say.calls.length, 0, 'nothing typed, and the walk stops -- later message left for the next poll');
  assert.equal(r.results.length, 1);
});

test('FIX 2: the owned-but-down message is DELIVERED once the worker is back (not lost across the retry)', () => {
  const msg = { ts: '720.0', text: env({ from: 'mac-1', to: 'reh-b', body: 'must not be lost' }) };
  // Poll 1: reh-b down -> blocked, cursor unmoved.
  const say1 = sayReturning({ ok: true });
  const r1 = run([msg], { liveNames: ['reh-a'], ownedNames: ['reh-a', 'reh-b'], say: say1 });
  assert.equal(r1.advanceTo, null);
  assert.equal(say1.calls.length, 0);
  // Poll 2 (worker restarted, now live): same message re-read -> delivered.
  const say2 = sayReturning({ ok: true });
  const r2 = run([msg], { liveNames: ['reh-a', 'reh-b'], ownedNames: ['reh-a', 'reh-b'], say: say2 });
  assert.equal(say2.calls.length, 1);
  assert.equal(say2.calls[0].name, 'reh-b');
  assert.equal(r2.advanceTo, '720.0', 'now it advances');
});

test('FIX 2: a REMOVED worker is not_local (advanced past), not blocked', () => {
  // Removed workers are excluded from ownedNames by ownedWorkerNames, so from
  // runInbox\'s view a removed name is simply not owned -> not_local -> advance.
  const say = sayReturning({ ok: true });
  const r = run([{ ts: '730.0', text: env({ from: 'mac-1', to: 'deleted-worker', body: 'gone' }) }], {
    liveNames: ['reh-a'], ownedNames: ['reh-a'], say,
  });
  assert.equal(r.results[0].kind, DISPOSITION.NOT_LOCAL);
  assert.equal(r.advanceTo, '730.0', 'a removed name must not block the queue forever');
});

// ── FIX 3: routed by to: alone; a name-collision cannot drop inbound ──────────

test('FIX 3: inbound from a remote agent whose name collides with a local worker is DELIVERED, not dropped', () => {
  const say = sayReturning({ ok: true });
  // `from` equals a live local worker name (winstream-1) -- a remote namesake -- but
  // the envelope is addressed to reh-a, a live local worker. It MUST be delivered.
  const r = run([{ ts: '800.0', text: env({ from: 'winstream-1', to: 'reh-a', body: 'legit cross-machine inbound' }) }], { liveNames: LIVE, say });
  assert.equal(say.calls.length, 1, 'from: never suppresses delivery');
  assert.equal(say.calls[0].name, 'reh-a');
  assert.equal(r.results[0].kind, DISPOSITION.PLACED);
  assert.equal(r.advanceTo, '800.0');
});

// ── FIX 1 (node side): a large backlog is not truncated; older addressed msgs deliver

test('FIX 1: a >100-message backlog delivers the OLDER addressed message, not just the newest', () => {
  // 150 filler messages plus one addressed message buried near the OLDEST end.
  const msgs = [];
  for (let i = 0; i < 150; i += 1) {
    msgs.push({ ts: (1000 + i) + '.0', text: env({ from: 'mac-1', to: 'not-ours-' + i, body: 'filler' }) });
  }
  // The addressed one is older than most (index 5), to prove nothing is truncated.
  msgs.push({ ts: '1005.5', text: env({ from: 'mac-1', to: 'reh-a', body: 'buried but must deliver' }) });
  const say = sayReturning({ ok: true });
  const r = run(msgs, { liveNames: LIVE, say });
  assert.equal(say.calls.length, 1, 'the buried older addressed message is delivered');
  assert.equal(say.calls[0].name, 'reh-a');
  assert.equal(r.advanceTo, (1000 + 149) + '.0', 'cursor advances across the whole contiguous handled range');
  assert.equal(r.results.length, 151, 'every message in the backlog is considered, not just the newest 100');
});

// ── roster / dry-run / ordering ──────────────────────────────────────────────

test('a roster we could not read refuses the whole poll and advances NOTHING (false-zero rule)', () => {
  const say = sayReturning({ ok: true });
  const r = win32inbox.runInbox(
    { messages: [{ ts: '900.0', text: env({ from: 'mac-1', to: 'winstream-1' }) }] },
    { liveOpts: { run: () => null, record: { read: () => ({}) } }, ownedNames: [], say },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, DISPOSITION.ROSTER_UNREADABLE);
  assert.equal(r.advanceTo, null, 'we cannot tell whether the envelope is for a live worker, so we advance nothing');
  assert.equal(say.calls.length, 0);
});

test('runInbox reads live + owned names from the real joins when none are injected', () => {
  const say = sayReturning({ ok: true });
  const OURS = '11111111-2222-3333-4444-555555555555';
  const record = { read: () => ({ [OURS]: { name: 'pigeonpete', runner: 'claude' } }) };
  const r = win32inbox.runInbox(
    { messages: [{ ts: '910.0', text: env({ from: 'mac-1', to: 'pigeonpete', body: 'via the join' }) }] },
    {
      liveOpts: { run: () => [{ sessionId: OURS, pid: 7, status: 'idle', name: 'pigeonpete-live' }], record },
      ownedOpts: { record, isRemoved: () => false },
      say,
    },
  );
  assert.equal(say.calls[0] && say.calls[0].name, 'pigeonpete', 'resolved through the win32live ownership join');
  assert.equal(r.advanceTo, '910.0');
});

test('dryRun (-Peek in delivery mode) reports routing but delivers nothing and advances nothing', () => {
  const say = sayReturning({ ok: true });
  const r = run([
    { ts: '950.0', text: env({ from: 'mac-1', to: 'reh-a', body: 'peek me' }) },
    { ts: '950.1', text: env({ from: 'mac-1', to: 'reh-b', body: 'peek down' }) },
  ], { liveNames: LIVE, ownedNames: ['reh-a', 'reh-b'], say, dryRun: true });
  assert.equal(say.calls.length, 0, 'a peek never calls say');
  assert.equal(r.advanceTo, null, 'a peek leaves the cursor untouched so the next real run sees these messages');
  assert.equal(r.results[0].kind, 'would_deliver');
  assert.equal(r.results[0].target, 'reh-a');
  assert.equal(r.results[1].kind, DISPOSITION.OWNED_DOWN, 'peek surfaces the owned-but-down block it would hit');
});

test('messages are handled oldest-first regardless of input order', () => {
  const say = sayReturning({ ok: true });
  const r = run([
    { ts: '1002', text: env({ from: 'mac-1', to: 'reh-a', body: 'second' }) },
    { ts: '1001', text: env({ from: 'mac-1', to: 'reh-a', body: 'first' }) },
  ], { liveNames: LIVE, say });
  assert.deepEqual(say.calls.map((c) => c.text.includes('first') ? 1 : 2), [1, 2], 'oldest ts delivered first');
  assert.equal(r.advanceTo, '1002', 'cursor ends at the newest handled ts');
});
