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
  // Captured before the limit (an idle screen), so the row is seen arriving.
  read(T - 60e3, STATUS_LINE, 'idle', () => {});
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

test('#5805 3b review 1: a row seen late, a quoted row, and a new limit printing the same words', () => {
  const line = `You've hit your session limit · resets 4pm ${Z}`;
  const t0 = Date.parse('2026-10-10T16:00:00Z');   // 11:00 CDT
  // 1. Already on screen at the board's FIRST capture of the agent (a restart): no time, so no hold and no retirement.
  status.noteLimitRows('casey', limitScreen(line), t0);
  assert.equal(status.limitFirstSeenOf('casey', line), null, 'a row seen late was timed');
  assert.equal(status.claudeLimitUntil('casey', line, t0), null);
  assert.ok(status.retireResetLimits(limitScreen(line), Date.parse('2026-10-11T03:00:00Z'), (row) => status.limitFirstSeenOf('casey', row)).includes('session limit'), 'a row seen late was retired');
  // 2. A quoted limit line (a tool result: indented, no turn footer of its own at column 0 within reach) is not recorded.
  status.noteLimitRows('kim', STATUS_LINE, t0 - 60e3);
  const quoted = '● Bash(cat capture.txt)\n' + `  ⎿  You've hit your session limit · resets 4pm ${Z}\n` + '     more output\n'.repeat(8) + STATUS_LINE;
  status.noteLimitRows('kim', quoted, t0);
  assert.equal(status.limitFirstSeenOf('kim', line), null, 'a quoted limit line set a first-seen time');
  // 3. Yesterday's retired row still in the scrollback, and today the same words again under it: a new limit, timed from today.
  status.noteLimitRows('leo', STATUS_LINE, t0 - 60e3);
  status.noteLimitRows('leo', limitScreen(line), t0);
  assert.equal(status.limitFirstSeenOf('leo', line), t0, 'CONTROL: the first limit was timed');
  const nextDay = t0 + 24 * 3600e3;
  status.noteLimitRows('leo', limitScreen(line), nextDay - 3600e3);   // still on screen overnight
  const twice = '> hello\n' + `  ⎿  ${line}\n` + FOOTER + '> again\n' + `  ⎿  ${line}\n` + FOOTER + STATUS_LINE;
  status.noteLimitRows('leo', twice, nextDay);
  assert.equal(status.limitFirstSeenOf('leo', line), nextDay, 'a new limit printing the same words kept yesterday\'s time');
  assert.ok(status.retireResetLimits(twice, nextDay + 60e3, (row) => status.limitFirstSeenOf('leo', row)).split('\n').filter((r) => r.includes('session limit')).length >= 1, 'today\'s live limit was retired on yesterday\'s time');
});

test('#5805 3b review 2: a row back within its span is late; a new one after it is timed; a relaunched agent starts over', () => {
  const line = `You've hit your session limit · resets 4pm ${Z}`;
  const t0 = Date.parse('2026-10-10T16:00:00Z');   // 11:00 CDT
  const on = limitScreen(line);
  // A row timed, gone three minutes (a redraw), back within its five hours: the same row, arrival unknown, so late.
  status.noteLimitRows('casey', STATUS_LINE, t0 - 60e3);
  status.noteLimitRows('casey', on, t0);
  status.noteLimitRows('casey', STATUS_LINE, t0 + 3 * 60e3);
  assert.equal(status.limitFirstSeenOf('casey', line), null, 'CONTROL: gone over two minutes ended it');
  status.noteLimitRows('casey', on, t0 + 4 * 3600e3);
  assert.equal(status.limitFirstSeenOf('casey', line), null, 'a row back within its span was timed afresh');
  // The same words after the span (gone again first): a new limit, timed from then.
  status.noteLimitRows('casey', STATUS_LINE, t0 + 4 * 3600e3 + 3 * 60e3);
  const later = t0 + 6 * 3600e3;
  status.noteLimitRows('casey', on, later);
  assert.equal(status.limitFirstSeenOf('casey', line), later, 'a new limit after the span was not timed');

  // An agent missing from a snapshot pass is no longer captured: back with a row on its screen, the row is late.
  status.noteLimitRows('leo', STATUS_LINE, t0 - 60e3);
  status.limitCaptureSweep(['casey', 'kim']);
  status.noteLimitRows('leo', on, t0);
  assert.equal(status.limitFirstSeenOf('leo', line), null, 'a relaunched agent\'s row was timed as arriving');
  // CONTROL: an agent present in the pass keeps being captured, so its new row is timed.
  status.noteLimitRows('ann', STATUS_LINE, t0 - 60e3);
  status.limitCaptureSweep(['ann']);
  status.noteLimitRows('ann', on, t0);
  assert.equal(status.limitFirstSeenOf('ann', line), t0, 'CONTROL: a present agent\'s new row was not timed');
});

test('#5805 3b review 3: a second copy of the same row (a redraw) never re-times a late row, one ahead of its reset, or a retired weekly row', () => {
  const t0 = Date.parse('2026-10-10T16:00:00Z');   // 11:00 CDT
  const twice = (line) => '> a\n' + `  ⎿  ${line}\n` + FOOTER + '> b\n' + `  ⎿  ${line}\n` + FOOTER + STATUS_LINE;
  const weekly = `You've hit your weekly limit · resets 4pm ${Z}`;
  const session = `You've hit your session limit · resets 4pm ${Z}`;
  // A. Seen late (first capture), then drawn twice: still late.
  status.noteLimitRows('casey', limitScreen(weekly), Date.parse('2026-10-10T22:00:00Z'));
  status.noteLimitRows('casey', twice(weekly), Date.parse('2026-10-10T22:01:00Z'));
  assert.equal(status.limitFirstSeenOf('casey', weekly), null, 'a duplicated late row was timed');
  // B. A weekly row timed, retired at its reset, then drawn twice: the same time, so it stays retired.
  status.noteLimitRows('kim', STATUS_LINE, t0 - 60e3);
  status.noteLimitRows('kim', limitScreen(weekly), t0);
  status.noteLimitRows('kim', twice(weekly), Date.parse('2026-10-10T21:35:00Z'));
  assert.equal(status.limitFirstSeenOf('kim', weekly), t0, 'a redraw past the reset re-timed a weekly row to tomorrow');
  // C. A session row ahead of its reset, drawn twice: the same time.
  status.noteLimitRows('leo', STATUS_LINE, t0 - 60e3);
  status.noteLimitRows('leo', limitScreen(session), t0);
  status.noteLimitRows('leo', twice(session), t0 + 3600e3);
  assert.equal(status.limitFirstSeenOf('leo', session), t0, 'a redraw ahead of the reset re-timed a session row');
  // CONTROL (review 1's case): a session row past its reset and a second identical one under it the next day: new.
  const nextDay = t0 + 24 * 3600e3;
  status.noteLimitRows('leo', limitScreen(session), nextDay - 3600e3);
  status.noteLimitRows('leo', twice(session), nextDay);
  assert.equal(status.limitFirstSeenOf('leo', session), nextDay, 'CONTROL: a new session limit with the same words was not timed');
});

test('#5805 3b review 3: an agent swept out loses its rows, so its first re-capture is late', () => {
  const t0 = Date.parse('2026-10-10T16:00:00Z');
  const session = `You've hit your session limit · resets 4pm ${Z}`;
  status.noteLimitRows('casey', STATUS_LINE, t0 - 60e3);
  status.noteLimitRows('casey', limitScreen(session), t0);
  assert.equal(status.limitFirstSeenOf('casey', session), t0, 'CONTROL: timed');
  status.limitCaptureSweep([]);   // gone from a pass (an empty list is the caller's to skip; the sweep itself drops all)
  status.noteLimitRows('casey', limitScreen(session), t0 + 60e3);
  assert.equal(status.limitFirstSeenOf('casey', session), null, 'a row at the first re-capture kept an older sighting\'s time');
});
