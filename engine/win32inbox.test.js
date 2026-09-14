'use strict';
/**
 * #2042 S1: the fleet inbound poller's delivery brain.
 *
 * These arms drive engine/win32inbox.js entirely through its seams -- a fake live
 * roster, a fake `say`, a fake win32live source -- so NO test ever touches a real
 * agent, pipe, board, or the Slack network. They pin the two things the poller must
 * get right: which envelope is addressed to a live local worker (W2), and what a
 * delivery verdict means for the Slack cursor (W4, no spool).
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

test('resolveTarget picks the live local worker among several to-names', () => {
  assert.equal(win32inbox.resolveTarget(['nobody', 'reh-a', 'winstream-1'], LIVE), 'reh-a',
    'the FIRST to-name that is a live local worker wins');
});

test('resolveTarget returns null for an unknown/dead name', () => {
  assert.equal(win32inbox.resolveTarget(['ghost-agent'], LIVE), null,
    'a name with no live supervisor is not a live local worker');
  assert.equal(win32inbox.resolveTarget([], LIVE), null);
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
  const r = win32inbox.runInbox(
    { messages: [{ ts: '100.1', text: env({ from: 'mac-1', to: 'winstream-1', body: 'ping' }) }] },
    { liveNames: LIVE, say },
  );
  assert.equal(r.ok, true);
  assert.equal(r.advanceTo, '100.1', 'a placed message advances the cursor to its ts');
  assert.equal(say.calls.length, 1);
  assert.equal(say.calls[0].name, 'winstream-1', 'delivered to the resolved live worker');
  assert.equal(r.results[0].kind, DISPOSITION.PLACED);
});

test('unconfirmed -> advance the cursor and log it', () => {
  const say = sayReturning({ ok: false, unsure: true, because: 'no answer in time' });
  const r = win32inbox.runInbox(
    { messages: [{ ts: '200.2', text: env({ from: 'mac-1', to: 'reh-a' }) }] },
    { liveNames: LIVE, say },
  );
  assert.equal(r.advanceTo, '200.2', 'unconfirmed still advances (avoids a duplicate send)');
  assert.equal(r.results[0].kind, DISPOSITION.UNCONFIRMED);
  assert.ok(r.results[0].because, 'the reason is carried so the ps1 can log it');
});

test('could_not -> cursor UNMOVED and later messages are NOT processed this poll', () => {
  const say = sayReturning({ ok: false, because: 'it is not running just now' });
  const r = win32inbox.runInbox(
    {
      messages: [
        { ts: '300.1', text: env({ from: 'mac-1', to: 'winstream-1', body: 'down agent' }) },
        { ts: '300.2', text: env({ from: 'mac-1', to: 'reh-a', body: 'later message' }) },
      ],
    },
    { liveNames: LIVE, say },
  );
  assert.equal(r.advanceTo, null, 'a could_not on the first message leaves the cursor before it -- that IS the retry');
  assert.equal(say.calls.length, 1, 'the walk STOPS at could_not; the later message is left for the next poll');
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].kind, DISPOSITION.COULD_NOT);
});

test('could_not after a placed keeps the cursor at the placed message, retries from the could_not', () => {
  // First message to a working agent, second to a down one. The cursor advances
  // only to the first; Slack oldest= is exclusive, so the next poll starts AFTER
  // the delivered one and re-reads the could_not.
  let n = 0;
  const say = (name, text) => { n += 1; return n === 1 ? { ok: true } : { ok: false, because: 'down' }; };
  const r = win32inbox.runInbox(
    {
      messages: [
        { ts: '400.1', text: env({ from: 'mac-1', to: 'reh-a', body: 'delivered' }) },
        { ts: '400.2', text: env({ from: 'mac-1', to: 'winstream-1', body: 'blocked' }) },
      ],
    },
    { liveNames: LIVE, say },
  );
  assert.equal(r.advanceTo, '400.1', 'cursor sits on the last delivered message, before the could_not');
});

test('an envelope for an unknown/dead name is not delivered and is advanced past (does not block)', () => {
  const say = sayReturning({ ok: true });
  const r = win32inbox.runInbox(
    { messages: [{ ts: '500.9', text: env({ from: 'mac-1', to: 'ghost-agent', body: 'nobody home' }) }] },
    { liveNames: LIVE, say },
  );
  assert.equal(say.calls.length, 0, 'no live supervisor -> nothing is typed');
  assert.equal(r.advanceTo, '500.9', 'a name that is not a live local worker is skipped, not retried forever');
  assert.equal(r.results[0].kind, DISPOSITION.NOT_LOCAL);
});

test('a malformed envelope is not delivered and is advanced past', () => {
  const say = sayReturning({ ok: true });
  const r = win32inbox.runInbox(
    { messages: [{ ts: '600.0', text: 'no envelope, no to: line, just noise' }] },
    { liveNames: LIVE, say },
  );
  assert.equal(say.calls.length, 0);
  assert.equal(r.advanceTo, '600.0');
  assert.equal(r.results[0].kind, DISPOSITION.NOT_LOCAL);
});

test('our own outgoing (from a live local worker) is not re-delivered', () => {
  const say = sayReturning({ ok: true });
  const r = win32inbox.runInbox(
    { messages: [{ ts: '700.0', text: env({ from: 'winstream-1', to: 'reh-a', body: 'sibling chatter' }) }] },
    { liveNames: LIVE, say },
  );
  assert.equal(say.calls.length, 0, 'an envelope FROM a live local worker is our own send, never inbound');
  assert.equal(r.advanceTo, '700.0');
  assert.equal(r.results[0].kind, DISPOSITION.NOT_LOCAL);
});

test('a roster we could not read refuses the whole poll and advances NOTHING (false-zero rule)', () => {
  // Drive win32live.byName through its own seams: a run() that returns null is the
  // shape of a failed `claude agents --json`, and byName turns that into null.
  const say = sayReturning({ ok: true });
  const r = win32inbox.runInbox(
    { messages: [{ ts: '800.0', text: env({ from: 'mac-1', to: 'winstream-1' }) }] },
    { liveOpts: { run: () => null, record: { read: () => ({}) } }, say },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, DISPOSITION.ROSTER_UNREADABLE);
  assert.equal(r.advanceTo, null, 'we cannot tell whether the envelope is for a live worker, so we advance nothing');
  assert.equal(say.calls.length, 0);
});

test('runInbox reads live names from win32live when none are injected', () => {
  // The real win32live join, driven by fakes: an agents list + an ownership record.
  // Proves runInbox actually resolves against win32live.byName in production.
  const say = sayReturning({ ok: true });
  const OURS = '11111111-2222-3333-4444-555555555555';
  const r = win32inbox.runInbox(
    { messages: [{ ts: '900.0', text: env({ from: 'mac-1', to: 'pigeonpete', body: 'via the join' }) }] },
    {
      liveOpts: {
        run: () => [{ sessionId: OURS, pid: 7, status: 'idle', name: 'pigeonpete-live' }],
        record: { read: () => ({ [OURS]: { name: 'pigeonpete', runner: 'claude' } }) },
      },
      say,
    },
  );
  assert.equal(say.calls[0] && say.calls[0].name, 'pigeonpete', 'resolved through the win32live ownership join');
  assert.equal(r.advanceTo, '900.0');
});

test('dryRun (-Peek in delivery mode) reports routing but delivers nothing and advances nothing', () => {
  const say = sayReturning({ ok: true });
  const r = win32inbox.runInbox(
    { messages: [{ ts: '950.0', text: env({ from: 'mac-1', to: 'reh-a', body: 'peek me' }) }] },
    { liveNames: LIVE, say, dryRun: true },
  );
  assert.equal(say.calls.length, 0, 'a peek never calls say');
  assert.equal(r.advanceTo, null, 'a peek leaves the cursor untouched so the next real run sees these messages');
  assert.equal(r.results[0].kind, 'would_deliver');
  assert.equal(r.results[0].target, 'reh-a');
});

test('messages are handled oldest-first regardless of input order', () => {
  const say = sayReturning({ ok: true });
  const r = win32inbox.runInbox(
    {
      messages: [
        { ts: '1002', text: env({ from: 'mac-1', to: 'reh-a', body: 'second' }) },
        { ts: '1001', text: env({ from: 'mac-1', to: 'reh-a', body: 'first' }) },
      ],
    },
    { liveNames: LIVE, say },
  );
  assert.deepEqual(say.calls.map((c) => c.text.includes('first') ? 1 : 2), [1, 2], 'oldest ts delivered first');
  assert.equal(r.advanceTo, '1002', 'cursor ends at the newest handled ts');
});
