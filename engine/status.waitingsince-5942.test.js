'use strict';
/* kosmos#5942: the card's waitingSince comes from the self-report's askedAt (#5943), only while the report's own
   state is the card's, and only a real time is kept. Both card paths (a pane card and a paneless one) carry it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-waitingsince-5942-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const status = require('./status');
const selfreport = require('./selfreport');
const sendertoken = require('./sendertoken');
const liveness = require('./liveness');
const fleet = require('../test-support/fleet');

const ASKED = '2026-10-01T10:00:00.000Z';

test('kosmos#5942 waitingSinceFrom: kept only for the same state and a real time in the past', () => {
  const now = Date.parse('2026-10-12T16:00:00Z');
  const r = (over) => Object.assign({ found: true, state: 'needs_you', askedAt: ASKED }, over);
  assert.equal(status.waitingSinceFrom(r(), 'needs_you', now), ASKED);
  assert.equal(status.waitingSinceFrom(r({ state: 'blocked' }), 'blocked', now), ASKED);
  assert.equal(status.waitingSinceFrom(r({ state: 'blocked' }), 'needs_you', now), null,
    'a question read off the screen over an older blocked report is a different wait');
  assert.equal(status.waitingSinceFrom(r({ askedAt: undefined }), 'needs_you', now), null, 'no askedAt (before #5943)');
  assert.equal(status.waitingSinceFrom(r({ askedAt: 'last week' }), 'needs_you', now), null);
  assert.equal(status.waitingSinceFrom(r({ askedAt: '2026-10-12T16:00:30Z' }), 'needs_you', now), null, 'ahead of the clock');
  assert.equal(status.waitingSinceFrom(r({ found: false }), 'needs_you', now), null, 'no report');
  assert.equal(status.waitingSinceFrom(null, 'needs_you', now), null);
});

/* These two arms wrap the read to pin askedAt to a fixed time, so the card's value can be compared exactly; on a
   waiting report only, as #5943 does. The arm at the end reads main's real askedAt with no wrapper. */
function withAskedAt(fn) {
  const real = selfreport.read;
  selfreport.read = function (name) {
    const out = real.apply(this, arguments);
    return out && out.found === true && (out.state === 'needs_you' || out.state === 'blocked') ? Object.assign({}, out, { askedAt: ASKED }) : out;
  };
  try { return fn(); } finally { selfreport.read = real; }
}

test('kosmos#5942: a pane card that is asking carries waitingSince; an idle one does not', () => {
  assert.equal(selfreport.record('wsasker', { state: 'needs_you', because: 'a question for the person' }).recorded, true);
  const cards = withAskedAt(() => {
    const board = fleet.install([fleet.agent('wsasker', { state: 'needs_you' }), fleet.agent('wsidle', { state: 'idle' })]);
    try { return board.agents; } finally { board.restore(); }
  });
  const asker = cards.find((c) => c.sessionName === 'wsasker');
  assert.equal(asker.state, 'needs_you', 'PRE-CONTROL: the card is asking');
  assert.equal(asker.waitingSince, ASKED);
  assert.equal(cards.find((c) => c.sessionName === 'wsidle').waitingSince, null, 'CONTROL: not waiting, no time');
});

test('kosmos#5942: a paneless card that is asking carries waitingSince too', () => {
  const tok = sendertoken.mint('wspaneless');
  assert.ok(tok && tok.token, 'the fixture could not mint a token');
  liveness.seen('wspaneless');
  assert.equal(selfreport.record('wspaneless', { state: 'needs_you', because: 'a question for the person' }).recorded, true);
  const cards = withAskedAt(() => {
    const board = fleet.install([fleet.agent('wsmac', { state: 'working' })]);
    try { return board.agents; } finally { board.restore(); }
  });
  const card = cards.find((c) => c.sessionName === 'wspaneless');
  assert.ok(card, 'PRE-CONTROL: the paneless agent is on the board');
  assert.equal(card.paneless, true, 'PRE-CONTROL: it is the paneless path');
  assert.equal(card.state, 'needs_you');
  assert.equal(card.waitingSince, ASKED);
});

test("kosmos#5942: with no wrapper, the card carries the self-report's own askedAt (#5943 on main), not the latest report's time", async () => {
  const q = { state: 'needs_you', because: 'a real question for the person' };
  assert.equal(selfreport.record('wsreal', q).recorded, true);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(selfreport.record('wsreal', q).recorded, true, 'the same question re-reported later');
  const report = selfreport.read('wsreal');
  assert.equal(typeof report.askedAt, 'string', "PRE-CONTROL: main's self-report carries askedAt (#5943)");
  assert.ok(Number.isFinite(Date.parse(report.askedAt)), 'PRE-CONTROL: a real time');
  assert.notEqual(report.askedAt, report.at, 'PRE-CONTROL: askedAt is the first report of the run, not the latest');
  const board = fleet.install([fleet.agent('wsreal', { state: 'needs_you' })]);
  let cards;
  try { cards = board.agents; } finally { board.restore(); }
  const card = cards.find((c) => c.sessionName === 'wsreal');
  assert.equal(card.state, 'needs_you', 'PRE-CONTROL: the card is asking');
  assert.equal(card.waitingSince, report.askedAt);
});
