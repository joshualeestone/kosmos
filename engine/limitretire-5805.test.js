'use strict';

/**
 * #5805 slice 3b: a dateless Claude limit line ("You've hit your session limit · resets 4pm (America/Chicago)") holds
 * automatic lines until its reset and is retired at it, so the card reads idle again, as a dated line already was
 * (slice 1, #5031). Its reset is read from when the board's screen pass first saw the row (status.noteLimitRows).
 *
 * Cards come from test-support/fleet with real limit screens; every reading goes through the real card builder at a
 * set clock.
 *
 *   node --test engine/limitretire-5805.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-limitretire-5805-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const status = require('./status');
const chat = require('./chat');
const fleet = require('../test-support/fleet');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
test.beforeEach(() => status.resetLimitFirstSeenForTests());

const Z = '(America/Chicago)';
function clock(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase()}`;
}
const RULE = '─'.repeat(80) + '\n';
const STATUS_LINE = RULE + '❯ \n' + RULE + '  casey · Opus 4.8 · 7d 100%\n' + '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents\n';
const FOOTER = '✻ Sautéed for 0s · done 10:35 PM\n';
const limitScreen = (line, menu) => '> hello\n' + `  ⎿  ${line}\n` + FOOTER
  + (menu ? '   What do you want to do?\n   1. Stop and wait for limit to reset\n' : '') + STATUS_LINE;

test('#5805 3b: retireResetLimits retires a dateless row past its first-seen reset, and only then', () => {
  const t0 = Date.parse('2026-10-10T16:00:00Z');   // 11:00 CDT
  const line = `You've hit your session limit · resets 4pm ${Z}`;   // 21:00Z
  const screen = limitScreen(line);
  const firstSeen = () => t0;
  const gone = (out) => !out.includes('hit your session limit');
  assert.ok(!gone(status.retireResetLimits(screen, Date.parse('2026-10-10T20:59:00Z'), firstSeen)), 'retired before its reset');
  assert.ok(gone(status.retireResetLimits(screen, Date.parse('2026-10-10T21:02:00Z'), firstSeen)), 'kept past its reset');
  // CONTROLS: no first-seen time (seen late) keeps it, as before; no lookup at all keeps it (the old signature); the
  // limit menu below it keeps it (a typed line would land in the menu).
  assert.ok(!gone(status.retireResetLimits(screen, Date.parse('2026-10-10T21:02:00Z'), () => null)), 'retired with no first-seen time');
  assert.ok(!gone(status.retireResetLimits(screen, Date.parse('2026-10-10T21:02:00Z'))), 'retired with no lookup');
  assert.ok(!gone(status.retireResetLimits(limitScreen(line, true), Date.parse('2026-10-10T21:02:00Z'), firstSeen)), 'retired under the limit menu');
  // A dated line is retired as before, with or without the lookup.
  const dated = limitScreen(`You've hit your weekly limit · resets Oct 9 at 3pm ${Z}`);
  assert.ok(!status.retireResetLimits(dated, t0, () => null).includes('weekly limit'), 'a passed dated line was kept');
});

test('#5805 3b: through the card builder, a dateless line holds until its reset and then reads idle (and is typed to)', () => {
  const real = Date.now;
  const T = Math.floor(real() / 60e3) * 60e3;
  const line = `You've hit your session limit · resets ${clock(T + 3600e3)} ${Z}`;
  const read = (ms, screen, state, fn) => {
    Date.now = () => ms;
    try {
      const board = fleet.install([fleet.agent('casey', { state, runner: 'claude', command: 'claude', screen })]);
      try { return fn(board.agents.find((c) => c.sessionName === 'casey'), board.agents); } finally { board.restore(); }
    } finally { Date.now = real; }
  };
  // First sight: capped, its reset an hour on, and an automatic line is held.
  read(T, limitScreen(line), 'rate_limited', (card, roster) => {
    assert.ok(card.limitUntil && Math.abs(Date.parse(card.limitUntil) - (T + 3600e3)) < 60e3, 'its reset was not read: ' + card.limitUntil);
    const v = chat.limitHeldVerdict('casey', roster, T + 60e3);
    assert.ok(v && v.heldBy === 'limit', 'a dateless line ahead of its reset was not held: ' + JSON.stringify(v));
  });
  // Half an hour on, the same row still on screen: still capped, still held.
  read(T + 1800e3, limitScreen(line), 'rate_limited', (card, roster) => {
    assert.ok(chat.limitHeldVerdict('casey', roster, T + 1800e3), 'released before its reset');
  });
  // Two minutes past the reset, the same row still on screen (it stays until something is typed): retired, the card
  // reads idle, nothing holds, and the first-seen time stands (the row is still there).
  read(T + 3600e3 + 120e3, limitScreen(line), 'idle', (card, roster) => {
    assert.equal(card.state, status.STATE.IDLE, 'the dateless line still read capped past its reset');
    assert.equal(chat.limitHeldVerdict('casey', roster, T + 3600e3 + 120e3), null, 'held past its reset with the line retired');
  });
  assert.ok(status.limitFirstSeenOf('casey', line) === T, 'the retired row lost its first-seen time while still on screen');
  // CONTROL: past the reset with Claude Code's limit menu on screen, it still reads capped (a typed line would land in
  // the menu) and is held, looking again in a minute.
  read(T + 3600e3 + 180e3, limitScreen(line, true), 'rate_limited', (card, roster) => {
    const v = chat.limitHeldVerdict('casey', roster, T + 3600e3 + 180e3);
    assert.ok(v && /still shows its usage limit on screen/.test(v.because), 'not held under the limit menu: ' + JSON.stringify(v));
  });
});
