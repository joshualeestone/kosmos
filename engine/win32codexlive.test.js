'use strict';
/**
 * #3380 the codex live source: enumerate the codex agents whose supervisor is up,
 * shaped like `claude agents --json` rows, and prove they UNION into the roster and
 * the ownership join with no branch. All arms run on any platform through injected
 * seams (no record store, no state files, no pids).
 *
 *   node --test engine/win32codexlive.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const codexlive = require('./win32codexlive');
const win32live = require('./win32live');
const win32roster = require('./win32roster');

/* A fake ownership record with a mix of claude and codex rows, one codex row whose
   supervisor is gone, and one whose presence names a stale session. */
const SID_CODEX_UP = '11111111-1111-4111-8111-111111111111';
const SID_CODEX_DEAD = '22222222-2222-4222-8222-222222222222';
const SID_CODEX_STALE = '33333333-3333-4333-8333-333333333333';
const SID_CLAUDE = '44444444-4444-4444-8444-444444444444';

function record() {
  return {
    read: () => ({
      [SID_CODEX_UP]: { name: 'coder', runner: 'codex' },
      [SID_CODEX_DEAD]: { name: 'gone', runner: 'codex' },
      [SID_CODEX_STALE]: { name: 'stale', runner: 'codex' },
      [SID_CLAUDE]: { name: 'clauder', runner: 'claude' },
    }),
  };
}

/* Presence: 'coder' up at pid 500, 'gone' up at 600 (but pid dead), 'stale' file
   names a DIFFERENT session id than the record. */
function identity(name) {
  if (name === 'coder') return { pid: 500, sessionId: SID_CODEX_UP };
  if (name === 'gone') return { pid: 600, sessionId: SID_CODEX_DEAD };
  if (name === 'stale') return { pid: 700, sessionId: 'some-other-id' };
  return null;
}
const pidAlive = (pid) => pid === 500;   // only coder's supervisor is alive

test('#3380 liveSessions emits ONLY the codex agent whose supervisor is alive', () => {
  const rows = codexlive.liveSessions({ record: record(), identity, pidAlive });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { sessionId: SID_CODEX_UP, pid: 500, name: 'coder', kind: 'interactive', runner: 'codex' });
});

test('#3380 a dead supervisor, a stale presence, and a claude row are all excluded', () => {
  const rows = codexlive.liveSessions({ record: record(), identity, pidAlive });
  const ids = rows.map((r) => r.sessionId);
  assert.ok(!ids.includes(SID_CODEX_DEAD), 'a dead supervisor is not live');
  assert.ok(!ids.includes(SID_CODEX_STALE), 'a presence naming another id is not this row');
  assert.ok(!ids.includes(SID_CLAUDE), 'a claude row is never a codex live row');
});

test('#3380 an unreadable record is an empty list (fail-closed), not a throw', () => {
  const rows = codexlive.liveSessions({ record: { read: () => { throw new Error('boom'); } }, identity, pidAlive });
  assert.deepEqual(rows, []);
});

test('#3380 win32live.byName UNIONS the codex agent into the ownership join', () => {
  /* claude source lists the claude session; codex source lists coder. Both recorded. */
  const run = () => [{ sessionId: SID_CLAUDE, name: 'live-derived', pid: 42, status: 'idle' }];
  const codexLive = () => codexlive.liveSessions({ record: record(), identity, pidAlive });
  const map = win32live.byName({ run, record: record(), codexLive });
  assert.ok(map.has('clauder'), 'the claude agent is still joined');
  assert.ok(map.has('coder'), 'the codex agent now joins too');
  assert.equal(map.get('coder').pid, 500, 'its pid is its supervisor');
  assert.equal(map.get('coder').runner, 'codex', 'the runner rides along for runningas');
  assert.equal(map.get('clauder').runner, 'claude');
});

test('#3380 byName STILL SEES the codex agent when the CLAUDE read fails (delivery gap)', () => {
  /* 🛑 THE FIX. The claude read failing says nothing about a codex agent, whose
     liveness is local and deterministic (record + presence + live pid). Refusing the
     whole map on a claude blip made a running codex agent vanish -- no roster card, so
     undeliverable and "Can't tell". So a failed claude read no longer hides codex. */
  const codexLive = () => codexlive.liveSessions({ record: record(), identity, pidAlive });
  const map = win32live.byName({ run: () => null, record: record(), codexLive });
  assert.ok(map, 'the map is not refused when a codex agent is up');
  assert.ok(map.has('coder'), 'the codex agent is enumerated through a failed claude read');
  assert.ok(!map.has('clauder'), 'the claude agent is absent -- we genuinely could not read claude');
});

test('#3380 byName STILL refuses (null) on a failed claude read when NO codex agent is up', () => {
  /* The load-bearing null is now CLAUDE-ONLY: with nothing local to show, a failed
     claude read is still "we could not look", not an empty machine. */
  const map = win32live.byName({ run: () => null, record: record(), codexLive: () => [] });
  assert.equal(map, null);
});

test('#3380 win32roster.make draws a CARD for the codex agent, with runner=codex', () => {
  const run = () => [];   // no claude agents
  const codexLive = () => codexlive.liveSessions({ record: record(), identity, pidAlive });
  const text = win32roster.make({ run, record: record(), codexLive })();
  const rows = text.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  const coder = rows.find((r) => r[0] === 'coder');
  assert.ok(coder, 'the codex agent has a roster row');
  // PANE_COLUMNS: session, pane, command, inMode, claim, runner, title
  assert.equal(coder[4], 'coder', 'claim === name (ownership)');
  assert.equal(coder[5], 'codex', 'the runner column names OpenAI');
  assert.equal(coder[2], win32roster.WIN32_COMMAND, 'classifies as a typeable win32 agent');
});

test('#3380 roster STILL draws the codex card when the claude read fails (delivery gap)', () => {
  /* 🛑 THE FIX, roster side: a codex agent draws its card through a claude blip, so it
     stays deliverable (chat.deliver gates on a roster card) instead of showing
     "Can't tell". */
  const codexLive = () => codexlive.liveSessions({ record: record(), identity, pidAlive });
  const text = win32roster.make({ run: () => null, record: record(), codexLive })();
  const rows = String(text).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  const coder = rows.find((r) => r[0] === 'coder');
  assert.ok(coder, 'the codex agent still has a roster row through a failed claude read');
  assert.equal(coder[5], 'codex');
  assert.ok(!rows.some((r) => r[0] === 'clauder'), 'no claude row -- we could not read claude');
});

test('#3380 roster STILL refuses (null) on a failed claude read when NO codex agent is up', () => {
  const text = win32roster.make({ run: () => null, record: record(), codexLive: () => [] })();
  assert.equal(text, null);
});

test('#3380 with no codex agents, byName and roster carry ONLY the claude agent', () => {
  const run = () => [{ sessionId: SID_CLAUDE, name: 'x', pid: 42, status: 'idle' }];
  const rec = { read: () => ({ [SID_CLAUDE]: { name: 'clauder', runner: 'claude' } }) };
  const codexLive = () => [];
  const map = win32live.byName({ run, record: rec, codexLive });
  assert.deepEqual([...map.keys()], ['clauder'], 'no codex row leaks in when there are no codex agents');
  const text = win32roster.make({ run, record: rec, codexLive })();
  // Parse rather than hand-type the tab columns (fixture-discipline forbids that).
  const rows = text.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  assert.equal(rows.length, 1, 'exactly one roster row, the claude agent');
  assert.equal(rows[0][0], 'clauder', 'session');
  assert.equal(rows[0][4], 'clauder', 'claim === name');
  assert.equal(rows[0][5], 'claude', 'runner column is claude');
});
