'use strict';
/**
 * The roster can hold an agent with NO PANE (#1112 phase 1).
 *
 * 🛑 THE PROBLEM, IN ONE SENTENCE. The board's idea of an agent is a tmux pane:
 * `snapshot()` builds its list from `tmux list-panes -a`, so on a machine with
 * no tmux there is nothing to list. #1124 already lets a paneless agent
 * IDENTIFY itself; this is the other half -- it has to APPEAR, or the report it
 * is now allowed to make lands on a board that cannot show it.
 *
 * ⚠️ EVERY ARM HERE HAS ITS OPPOSITE. A suite that only proves the new row can
 * appear proves nothing about the thing that matters, which is that a
 * CREDENTIAL ALONE CANNOT MANUFACTURE PRESENCE. So the token-with-no-beat, the
 * stale beat and the revoked token are asserted as absences, against a positive
 * control arranged the same way in the same file.
 *
 *   node --test engine/status.paneless-roster.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-paneless-roster-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const sendertoken = require('./sendertoken');
const liveness = require('./liveness');
const selfreport = require('./selfreport');
const chat = require('./chat');
const fleet = require('../test-support/fleet');

/* Every test starts from a store holding nothing, so an absence asserted here
   is this test's own arrangement and not a leftover from the one before. */
function clearStores() {
  for (const dir of [sendertoken.DIR, liveness.DIR, selfreport.DIR]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* not there yet */ }
  }
}

/** A paneless agent: a held token and a beat, and nothing else. */
function paneless(name, opts = {}) {
  const tok = sendertoken.mint(name);
  assert.ok(tok && tok.token, 'the fixture could not mint a token for ' + name);
  if (opts.beat !== false) liveness.seen(name, opts.at);
  return tok;
}

/* One Mac pane in every fleet below, and it is not decoration: it is the
   control. An assertion that a paneless row is absent means nothing if the
   board came back empty for some unrelated reason, so every absence is read
   off a board that demonstrably has somebody on it. */
const MAC = () => [fleet.agent('mara', { state: 'working' })];

test('a paneless agent with a live beat appears on the board', () => {
  clearStores();
  paneless('winbox');
  const board = fleet.install(MAC());
  try {
    const card = board.card('winbox');
    assert.equal(card.paneless, true, 'the row is there but not marked paneless');
    assert.equal(card.sessionName, 'winbox');
    // The control, in the same read: the Mac agent is still here and is NOT
    // marked paneless, so `paneless` is discriminating rather than constant.
    assert.equal(board.card('mara').paneless, false);
  } finally { board.restore(); }
});

test('it can report blocked, which is what the board exists to show', () => {
  clearStores();
  paneless('winbox');
  const r = selfreport.record('winbox', { state: 'blocked', on: 'a signed installer', owner: 'Josh' });
  assert.equal(r.recorded, true, 'the report was refused: ' + r.because);
  const board = fleet.install(MAC());
  try {
    const card = board.card('winbox');
    assert.equal(card.state, 'blocked');
    assert.equal(card.stateReported, true, 'the state did not come from the agent’s own account');
    assert.match(card.because, /signed installer/);
  } finally { board.restore(); }
});

test('🛑 a held token with NO beat does not appear', () => {
  clearStores();
  paneless('quiet', { beat: false });
  const board = fleet.install(MAC());
  try {
    assert.equal(board.agents.some((a) => a.sessionName === 'quiet'), false,
      'a credential alone put an agent on the board');
    assert.equal(board.agents.some((a) => a.sessionName === 'mara'), true,
      'the control is missing, so the absence above proves nothing');
  } finally { board.restore(); }
});

test('🛑 a stale beat does not appear', () => {
  clearStores();
  paneless('gone', { at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
  const board = fleet.install(MAC());
  try {
    assert.equal(board.agents.some((a) => a.sessionName === 'gone'), false,
      'an agent that stopped beating ten minutes ago is still on the board');
    assert.equal(board.agents.some((a) => a.sessionName === 'mara'), true);
  } finally { board.restore(); }
});

test('🛑 revoking the token takes the card off, beat or no beat', () => {
  clearStores();
  paneless('cutoff');
  let board = fleet.install(MAC());
  try {
    assert.equal(board.card('cutoff').paneless, true, 'the positive arm did not arrange');
  } finally { board.restore(); }

  sendertoken.revoke('cutoff');
  liveness.seen('cutoff');            // still beating, deliberately
  board = fleet.install(MAC());
  try {
    assert.equal(board.agents.some((a) => a.sessionName === 'cutoff'), false,
      'a revoked agent kept its card because it was still beating');
  } finally { board.restore(); }
});

test('the pane wins on a tie: an agent with both appears exactly once', () => {
  clearStores();
  paneless('mara');                   // same name as the Mac pane below
  const board = fleet.install(MAC());
  try {
    const rows = board.agents.filter((a) => a.sessionName === 'mara');
    assert.equal(rows.length, 1, 'the same agent is on the board twice');
    assert.equal(rows[0].paneless, false, 'the paneless row replaced the richer pane row');
    assert.ok(rows[0].target, 'the surviving row lost its pane target');
  } finally { board.restore(); }
});

test('🛑 a paneless card cannot be typed into, and its target is null not empty', () => {
  clearStores();
  paneless('winbox');
  const board = fleet.install(MAC());
  try {
    const card = board.card('winbox');
    /* NULL, NOT ''. Two routes match a reporting process to its card with
       `c.target === body.from_pane` behind a `typeof … === 'string'` gate, so
       an empty string here would be matched by `from_pane: ""`. */
    assert.equal(card.target, null);
    assert.equal(card.isAgentPane, false);

    const refused = chat.deliver('winbox', 'are you there', board.agents);
    assert.equal(refused.state, chat.DELIVERY.COULD_NOT,
      'Kosmos tried to type into an agent that has no window');
    assert.match(refused.because, /where this agent is running/);
  } finally { board.restore(); }
});

test('a paneless agent is not counted as an unreadable context', () => {
  clearStores();
  const withNobody = fleet.install(MAC());
  let baseline;
  try { baseline = withNobody.counts.unreadableTokens; } finally { withNobody.restore(); }
  /* ⚠️ THE ANTI-VACUITY ARM. If nothing on this board were ever counted, the
     assertion below would hold for a count that simply never fires, and this
     test would pass while measuring nothing. The Mac pane HAS an unreadable
     context in the sandbox, so the count is live before the paneless row is
     added, and staying put is then a real fact about the exclusion. */
  assert.ok(baseline >= 1, 'the count never fires, so the assertion below proves nothing');

  paneless('winbox');
  const board = fleet.install(MAC());
  try {
    assert.equal(board.card('winbox').context.tokens, null, 'the arrangement is wrong: it has a context');
    assert.equal(board.counts.unreadableTokens, baseline,
      'the paneless row was counted as a transcript we tried and failed to read');
  } finally { board.restore(); }
});
