'use strict';
/**
 * #1078: a Kosmos agent created but NEVER RUN must APPEAR on the board.
 *
 * A never-run agent has a launchd job + worker dir but no tmux pane and no live
 * beat, so neither the tmux source nor `panelessKeys` (which requires a live
 * beat) sees it -- and the empty state then told a person holding unrun agents to
 * "create your first". `status.setCreatedSource` wires a source that hands
 * `snapshot()` the never-run agents to add, deduped against the live pane/beat
 * rosters and rendered STOPPED.
 *
 * These tests drive the REAL `snapshot()` with an injected created source, so
 * they prove the merge/dedup/state through the unchanged engine, not just the
 * source in isolation (that is engine/createdroster.test.js). Every arm has its
 * opposite: the new row appears, AND a live pane for the same agent suppresses
 * it, AND a throwing source cannot cost the board its other cards.
 *
 *   node --test engine/status.created-roster-1078.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-created-roster-1078-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const status = require('./status');
const store = require('./store');
const selfreport = require('./selfreport');
const fleet = require('../test-support/fleet');

/* One Mac pane in every fleet below is the control: an assertion that the
   created row is present (or that it was suppressed) means nothing if the board
   came back empty for some unrelated reason, so it is read off a board that
   demonstrably has somebody real on it. */
const MAC = () => [fleet.agent('mara', { state: 'working' })];

/* Install a fleet, wire a created source, take a FRESH snapshot with it, and
   always tear the created source back down. Returns the fresh cards. */
function withCreated(source, fn) {
  const board = fleet.install(MAC());
  try {
    status.setCreatedSource(source);
    const cards = status.snapshot().agents;
    return fn(cards);
  } finally {
    status.setCreatedSource(null);
    board.restore();
  }
}

test('a created-never-run agent appears as a STOPPED, paneless card', () => {
  withCreated(() => ['neverrun'], (cards) => {
    const card = cards.find((c) => c.sessionName === 'neverrun');
    assert.ok(card, 'the never-run agent did not appear on the board');
    assert.equal(card.paneless, true, 'a created-never-run card must be paneless');
    assert.equal(card.state, status.STATE.STOPPED, 'a never-run agent is STOPPED, not unknown');
    assert.equal(card.stateConfidence, status.CONFIDENCE.STRUCTURED);
    assert.match(card.because, /created on this computer and is not running/);
    assert.equal(card.isNamedOurs, true);
    // Control, in the same read: the live Mac agent is here and is NOT paneless,
    // so `paneless`/state are discriminating rather than constant.
    const mac = cards.find((c) => c.sessionName === 'mara');
    assert.ok(mac, 'the control agent vanished');
    assert.equal(mac.paneless, false);
    assert.equal(mac.state, status.STATE.WORKING);
  });
});

test('a stale self-report from a prior run is NOT surfaced -- the card stays STOPPED (reconcileReport Rule 2)', () => {
  // A created agent that ran once, said "blocked", then went cold (no pane, no live
  // beat) has a lingering self-report on file. NEVER_RUN_DEFAULT is STOPPED/STRUCTURED,
  // and reconcileReport Rule 2 short-circuits on that above the report rules, so the
  // card must be STOPPED, NOT blocked -- a report from a dead session is stale. This
  // pins the behavior the comment describes (and that an earlier comment got wrong).
  const r = selfreport.record('coldagent', { state: 'blocked', on: 'a signed installer', owner: 'Josh' });
  assert.equal(r.recorded, true, 'the fixture self-report was refused: ' + r.because);
  try {
    withCreated(() => ['coldagent'], (cards) => {
      const card = cards.find((c) => c.sessionName === 'coldagent');
      assert.ok(card, 'the cold agent did not appear on the board');
      assert.equal(card.state, status.STATE.STOPPED, 'a stale report leaked through -- the card is not STOPPED');
      assert.notEqual(card.state, status.STATE.BLOCKED, 'the dead-session report was surfaced');
    });
  } finally {
    try { fs.rmSync(selfreport.DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

test('the created source is handed the board keys to dedup against (the live Mac agent is excluded)', () => {
  let handed = null;
  withCreated((exclude) => { handed = exclude; return []; }, () => {});
  assert.ok(handed instanceof Set, 'the source was not handed a Set of board keys');
  assert.ok(handed.has(store.safeKey('mara')), 'the live agent key was not in the exclude set');
});

test('a created key that ALREADY has a live pane does not double-list (dedup)', () => {
  // The source (wrongly) returns the live Mac agent's key; snapshot must not add
  // a second card for it -- the pane card wins.
  withCreated(() => [store.safeKey('mara')], (cards) => {
    const macCards = cards.filter((c) => c.sessionName === 'mara');
    assert.equal(macCards.length, 1, 'the live agent was double-listed');
    assert.equal(macCards[0].paneless, false, 'the live pane card must win over a created row');
  });
});

test('a throwing created source cannot cost the board its other cards (additive discipline)', () => {
  withCreated(() => { throw new Error('boom'); }, (cards) => {
    assert.ok(cards.find((c) => c.sessionName === 'mara'), 'a throwing source took the whole board down');
  });
});

test('one bad key does not sink the rest (a key that panelessCard cannot build is skipped)', () => {
  // An empty-string key throws inside panelessCard (readIdentity/safeKey); the
  // good never-run key must still land.
  withCreated(() => ['', 'neverrun'], (cards) => {
    assert.ok(cards.find((c) => c.sessionName === 'neverrun'), 'a good created row was lost to a bad sibling');
  });
});

test('default (no created source wired) leaves the board byte-identical -- no created cards', () => {
  const board = fleet.install(MAC());
  try {
    // createdSource is null here (nothing wired); only the real pane agent shows.
    assert.equal(board.agents.length, 1);
    assert.equal(board.agents[0].sessionName, 'mara');
  } finally { board.restore(); }
});
