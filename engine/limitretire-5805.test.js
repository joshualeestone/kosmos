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
const NEW_FOOTER = '✻ Baked for 2s · done 11:02 AM\n';   // the footer of a later turn
const limitScreen = (line, menu) => '❯ hello\n' + `  ⎿  ${line}\n` + FOOTER
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
  const twice = '❯ hello\n' + `  ⎿  ${line}\n` + FOOTER + '❯ again\n' + `  ⎿  ${line}\n` + NEW_FOOTER + STATUS_LINE;   // a new turn's footer
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
  status.noteLimitRows('casey', STATUS_LINE, later - 30e3);   // the board capturing as usual (no gap)
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
  const twice = (line) => '❯ a\n' + `  ⎿  ${line}\n` + FOOTER + '❯ b\n' + `  ⎿  ${line}\n` + FOOTER + STATUS_LINE;
  const weekly = `You've hit your weekly limit · resets 4pm ${Z}`;
  const session = `You've hit your session limit · resets 4pm ${Z}`;
  // A. Seen late (first capture), then drawn twice: still late.
  status.noteLimitRows('casey', limitScreen(weekly), Date.parse('2026-10-10T22:00:00Z'));
  status.noteLimitRows('casey', twice(weekly), Date.parse('2026-10-10T22:01:00Z'));
  assert.equal(status.limitFirstSeenOf('casey', weekly), null, 'a duplicated late row was timed');
  // A2. A late SESSION row (first capture at 15:00 CDT), drawn twice past its 4pm: still late (the session rule alone
  // would re-time it).
  status.noteLimitRows('ann', limitScreen(session), Date.parse('2026-10-10T20:00:00Z'));
  status.noteLimitRows('ann', twice(session), Date.parse('2026-10-10T21:35:00Z'));
  assert.equal(status.limitFirstSeenOf('ann', session), null, 'a duplicated late session row was timed');
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
  // CONTROL (review 1's case): a session row past its reset and a second identical one under it the next day, ending
  // a new turn: new.
  const nextDay = t0 + 24 * 3600e3;
  status.noteLimitRows('leo', limitScreen(session), nextDay - 3600e3);
  status.noteLimitRows('leo', '❯ a\n' + `  ⎿  ${session}\n` + FOOTER + '❯ b\n' + `  ⎿  ${session}\n` + NEW_FOOTER + STATUS_LINE, nextDay);
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

test('#5805 3b review 4: a row first seen after a long gap in captures (a Mac asleep through the reset) is late', () => {
  const weekly = `You've hit your weekly limit · resets 4pm ${Z}`;
  const mon = Date.parse('2026-10-12T22:00:00Z');   // Monday 17:00 CDT, the board capturing casey
  status.noteLimitRows('casey', STATUS_LINE, mon);
  status.noteLimitRows('casey', limitScreen(weekly), mon + 24 * 3600e3);   // Tuesday 17:00, after a day asleep
  assert.equal(status.limitFirstSeenOf('casey', weekly), null, 'a row first seen after a day-long gap was timed (a free agent held until Wednesday)');
  // CONTROL: captures a few seconds apart, the row timed.
  status.noteLimitRows('kim', STATUS_LINE, mon);
  status.noteLimitRows('kim', limitScreen(weekly), mon + 5e3);
  assert.equal(status.limitFirstSeenOf('kim', weekly), mon + 5e3, 'CONTROL: a row seen arriving was not timed');
});

test('#5805 3b review 5: a redraw the next day (the old block copied, footer and all) never re-times a retired session row', () => {
  const session = `You've hit your session limit · resets 4pm ${Z}`;   // 21:00Z
  const t0 = Date.parse('2026-10-10T16:00:00Z');   // 11:00 CDT
  status.noteLimitRows('casey', STATUS_LINE, t0 - 60e3);
  status.noteLimitRows('casey', limitScreen(session), t0);
  // Overnight, the row still on screen and the board capturing all along.
  for (let t = t0 + 60e3; t < Date.parse('2026-10-11T18:00:00Z'); t += 60e3) status.noteLimitRows('casey', limitScreen(session), t);
  // Next day 13:00 CDT (18:00Z): a resize reprints the transcript, so the capture shows the row twice, same footer.
  const redraw = Date.parse('2026-10-11T18:00:00Z');
  const copied = '❯ hello\n' + `  ⎿  ${session}\n` + FOOTER + '❯ hello\n' + `  ⎿  ${session}\n` + FOOTER + STATUS_LINE;
  status.noteLimitRows('casey', copied, redraw);
  assert.equal(status.limitFirstSeenOf('casey', session), t0, 'a redraw re-timed the retired row');
  assert.equal(status.claudeLimitUntil('casey', session, redraw), Date.parse('2026-10-10T21:00:00Z'), 'its reset moved');
  assert.ok(!status.retireResetLimits(copied, redraw, (row) => status.limitFirstSeenOf('casey', row)).includes('session limit'), 'the redrawn row was un-retired (a free agent held)');
});

test('#5805 3b review 7: an older row the board saw late does not hide a newer limit: the newer is held, then retired', () => {
  const real = Date.now;
  const read = (ms, screen, state, fn) => {
    Date.now = () => ms;
    try {
      const board = fleet.install([fleet.agent('casey', { state, runner: 'claude', command: 'claude', screen })]);
      try { return fn(board.agents.find((c) => c.sessionName === 'casey'), board.agents); } finally { board.restore(); }
    } finally { Date.now = real; }
  };
  const old = `You've hit your session limit · resets 4pm ${Z}`;
  const fresh = `You've hit your session limit · resets 9pm ${Z}`;
  const oldBlock = '❯ hello\n' + `  ⎿  ${old}\n` + FOOTER;
  const both = oldBlock + '❯ carry on\n' + `  ⎿  ${fresh}\n` + NEW_FOOTER + STATUS_LINE;
  const t14 = Date.parse('2026-10-10T19:00:00Z');   // 14:00 CDT: the board restarts with the 4pm row on screen
  read(t14, oldBlock + STATUS_LINE, 'rate_limited', (card) => assert.equal(card.limitUntil, null, 'CONTROL: the row seen late has no time'));
  // 17:00 CDT: woken, it worked and hit a new limit (9pm) under the old row; the board captured all along.
  const t17 = Date.parse('2026-10-10T22:00:00Z');
  // kosmos#7264: the row seen late is timed from that sighting for retiring, so it is retired at its own 4pm reset
  // (21:00Z, plus the minute's grace) and the agent reads idle until the newer limit at 17:00. Before #7264 a late row
  // was never retired, and this loop asked for rate_limited all the way to 17:00.
  const oldReset = Date.parse('2026-10-10T21:00:00Z') + 60e3;
  for (let t = t14 + 60e3; t < t17; t += 60e3) read(t, oldBlock + STATUS_LINE, t < oldReset ? 'rate_limited' : 'idle', () => {});
  read(t17, both, 'rate_limited', (card, roster) => {
    assert.ok(card.limitUntil && Date.parse(card.limitUntil) === Date.parse('2026-10-11T02:00:00Z'), 'the newer limit\'s reset was hidden: ' + card.limitUntil);
    const v = chat.limitHeldVerdict('casey', roster, t17);
    assert.ok(v && v.heldBy === 'limit', 'the newer limit was not held: ' + JSON.stringify(v));
  });
  // 21:02 CDT, both rows still on screen: the newer is retired and the older one does not keep the card capped.
  const t2102 = Date.parse('2026-10-11T02:02:00Z');
  for (let t = t17 + 60e3; t < t2102; t += 60e3) read(t, both, null, () => {});
  read(t2102, both, 'idle', (card) => assert.equal(card.state, status.STATE.IDLE, 'an older row kept the card capped past the newer limit\'s reset'));
});

test('#5805 3b review 8: a quoted limit line ending a turn never retires the real, binding row above it', () => {
  const t0 = Date.parse('2026-10-10T16:00:00Z');
  const weekly = `You've hit your weekly limit · resets Oct 14 at 12am ${Z}`;   // binding, days ahead
  const quoted = `You've hit your session limit · resets 4pm ${Z}`;
  const screen = '❯ hello\n' + `  ⎿  ${weekly}\n` + FOOTER
    + '● Bash(cat old-capture.txt)\n' + `  ⎿  ${quoted}\n` + NEW_FOOTER + STATUS_LINE;   // the turn ended on the tool result
  const out = status.retireResetLimits(screen, t0, () => t0 - 6 * 3600e3);
  assert.ok(out.includes('weekly limit'), 'a quoted line under a tool call retired the binding weekly row');
  // CONTROL: the same newer row straight under the person's prompt is a newer limit, and the older row goes.
  const real = '❯ hello\n' + `  ⎿  ${weekly}\n` + FOOTER + '❯ again\n' + `  ⎿  ${quoted}\n` + NEW_FOOTER + STATUS_LINE;
  assert.ok(!status.retireResetLimits(real, t0, () => null).includes('weekly limit'), 'CONTROL: a newer limit under a prompt did not retire the older row');
});

test('#5805 3b review 9: a quoted limit line ending a turn is never timed, so a free agent is never held on it', () => {
  const t0 = Date.parse('2026-10-10T16:00:00Z');   // 11:00 CDT
  const quoted = `You've hit your session limit · resets 4pm ${Z}`;
  const grep = "● Bash(grep 'hit your' engine/status.test.js)\n" + `  ⎿  ${quoted}\n` + '✻ Cooked for 3s · done 11:02 AM\n' + STATUS_LINE;
  status.noteLimitRows('casey', STATUS_LINE, t0 - 30e3);
  status.noteLimitRows('casey', grep, t0);
  assert.equal(status.limitFirstSeenOf('casey', quoted), null, 'a quoted limit line in a tool result was timed');
  assert.equal(status.claudeLimitUntil('casey', quoted, t0), null);
  // CONTROL: the same row straight under the person's prompt is a limit Claude Code printed, and is timed.
  status.noteLimitRows('kim', STATUS_LINE, t0 - 30e3);
  status.noteLimitRows('kim', '❯ hello\n' + `  ⎿  ${quoted}\n` + '✻ Cooked for 3s · done 11:02 AM\n' + STATUS_LINE, t0);
  assert.equal(status.limitFirstSeenOf('kim', quoted), t0, 'CONTROL: a real limit under the prompt was not timed');
});

test('kosmos#7264: a dateless row the board saw late (on its first capture after a restart) is retired, not kept for good', () => {
  const real = Date.now;
  const read = (ms, screen, state, fn) => {
    Date.now = () => ms;
    try {
      const board = fleet.install([fleet.agent('camille', { state, runner: 'claude', command: 'claude', screen })]);
      try { return fn(board.agents.find((c) => c.sessionName === 'camille'), board.agents); } finally { board.restore(); }
    } finally { Date.now = real; }
  };
  const row = `You've hit your session limit · resets 6pm ${Z}`;
  const screen = '❯ hello\n' + `  ⎿  ${row}\n` + FOOTER + STATUS_LINE;
  // Josh's laptop, 10-26: the limit at 17:32 CDT, reset 6pm, the board restarting at 19:20 with the row still on an idle
  // agent's screen. The next 6pm is beyond a session limit's span, so the reset was the one before the sighting: idle.
  const restart = Date.parse('2026-10-27T00:20:00Z');
  read(restart, screen, 'idle', (card, roster) => {
    assert.equal(card.state, status.STATE.IDLE, 'a late row whose reset had passed kept the card capped (Rate Limit for good)');
    assert.equal(chat.limitHeldVerdict('camille', roster, restart), null, 'a message to it was held');
  });
  // A late row whose reset is still ahead: seen at 17:40 CDT, before 6pm. Capped until 18:00 (plus the grace), idle after.
  status.resetLimitFirstSeenForTests();
  const early = Date.parse('2026-10-26T22:40:00Z');
  read(early, screen, 'rate_limited', (card, roster) => {
    assert.equal(card.limitUntil, null, 'CONTROL: a late row still has no limitUntil, so delivery is not held on it');
    assert.equal(chat.limitHeldVerdict('camille', roster, early), null, 'CONTROL: and a message to it is typed');
  });
  const bound = Date.parse('2026-10-26T23:00:00Z') + 60e3;
  for (let t = early + 60e3; t < bound; t += 60e3) read(t, screen, 'rate_limited', () => {});
  read(bound, screen, 'idle', (card) => assert.equal(card.state, status.STATE.IDLE, 'the late row was not retired at its reset plus the grace'));
});

test('kosmos#7264: the late rules, as retireResetLimits reads them: never early, and gone once the reset is past', () => {
  const row = `You've hit your session limit · resets 6pm ${Z}`;   // 23:00Z on 10-26
  const screen = '❯ hello\n' + `  ⎿  ${row}\n` + FOOTER + STATUS_LINE;
  const kept = (now, first) => status.retireResetLimits(screen, now, () => first).includes('session limit');
  // Seen late at 17:40 CDT, before 6pm: the reset is still ahead, so capped until it (never early), gone after it.
  const s1740 = Date.parse('2026-10-26T22:40:00Z');
  assert.ok(kept(Date.parse('2026-10-26T22:59:00Z'), { at: s1740, late: true, count: 1 }), 'a late row was retired before its reset');
  assert.ok(!kept(Date.parse('2026-10-26T23:02:00Z'), { at: s1740, late: true, count: 1 }), 'CONTROL: and not after it');
  // Seen late long after the reset (03:00 CDT, more than a session span later): gone at once.
  const s0300 = Date.parse('2026-10-27T08:00:00Z');
  assert.ok(!kept(s0300, { at: s0300, late: true, count: 1 }), 'a late row seen more than a span after its reset was kept');
  // The same sighting NOT late (seen arriving) keeps it: a row timed from its arrival is never read as already past.
  assert.ok(kept(s0300, { at: s0300, late: false, count: 1 }), 'CONTROL: a row seen arriving was retired at once');
  // A row this cannot read (an unknown zone): kept, as before.
  const odd = screen.replace('(America/Chicago)', '(Nowhere/Atlantis)');
  assert.ok(status.retireResetLimits(odd, s0300, () => ({ at: s0300, late: true, count: 1 })).includes('session limit'), 'an unreadable row was retired');
  // A daily wording seen late within its day: retired at its next reset, never sooner.
  const weekly = `You've hit your weekly limit · resets 6pm ${Z}`;
  const wscreen = '❯ hello\n' + `  ⎿  ${weekly}\n` + FOOTER + STATUS_LINE;
  assert.ok(status.retireResetLimits(wscreen, Date.parse('2026-10-27T22:59:00Z'), () => ({ at: s0300, late: true, count: 1 })).includes('weekly limit'), 'a late daily row was retired before its next reset');
  assert.ok(!status.retireResetLimits(wscreen, Date.parse('2026-10-27T23:02:00Z'), () => ({ at: s0300, late: true, count: 1 })).includes('weekly limit'), 'CONTROL: and kept after it');
  // And with no sighting at all, kept, as before.
  assert.ok(kept(Date.parse('2026-10-28T00:00:00Z'), null), 'a row with no sighting was retired');
});

test('kosmos#7264 review 2: a NEW limit printing the same words after a late sighting is timed from its arrival, never lifted while it binds; a redraw does not re-cap a retired row', () => {
  const real = Date.now;
  const read = (ms, screen, state) => {
    Date.now = () => ms;
    try { const board = fleet.install([fleet.agent('camille', { state, runner: 'claude', command: 'claude', screen })]); board.restore(); }
    finally { Date.now = real; }
  };
  const row = `You've hit your session limit · resets 6pm ${Z}`;
  const oldBlock = '❯ hello\n' + `  ⎿  ${row}\n` + FOOTER;
  const newBlock = '❯ do the report\n' + `  ⎿  ${row}\n` + NEW_FOOTER;
  const minutes = (from, to, screen, state) => { for (let t = from; t < to; t += 60e3) read(t, screen, state); };
  // Scenario A: restart 17:40 CDT on day 1 with the 6pm row (late, retired at 18:01), the row left on screen overnight;
  // day 2 at 15:00 a new 6pm limit prints under it. It binds until 18:00 on day 2.
  status.resetLimitFirstSeenForTests();
  const d1 = Date.parse('2026-10-26T22:40:00Z');
  minutes(d1, Date.parse('2026-10-26T23:01:00Z'), oldBlock + STATUS_LINE, 'rate_limited');
  const d2 = Date.parse('2026-10-27T20:00:00Z');   // 15:00 CDT
  minutes(Date.parse('2026-10-26T23:01:00Z'), d2, oldBlock + STATUS_LINE, 'idle');
  minutes(d2, Date.parse('2026-10-27T23:01:00Z'), oldBlock + newBlock + STATUS_LINE, 'rate_limited');
  read(Date.parse('2026-10-27T23:01:00Z'), oldBlock + newBlock + STATUS_LINE, 'idle');
  // Scenario B: restart 19:20 CDT after the reset (retired at once); day 2 the new limit's capture is the first without
  // the old row (scrolled off in the same capture). Still timed from its arrival, so capped until 18:00.
  status.resetLimitFirstSeenForTests();
  const r = Date.parse('2026-10-27T00:20:00Z');
  minutes(r, d2, oldBlock + STATUS_LINE, 'idle');
  minutes(d2, Date.parse('2026-10-27T23:01:00Z'), newBlock + STATUS_LINE, 'rate_limited');
  // Redraw: after that late row was retired, a resize reprints the old block twice with its own footer: still idle.
  status.resetLimitFirstSeenForTests();
  minutes(r, r + 30 * 60e3, oldBlock + STATUS_LINE, 'idle');
  minutes(r + 30 * 60e3, r + 40 * 60e3, oldBlock + oldBlock + STATUS_LINE, 'idle');
  // (These reads assert by fleet.install, which throws when the engine classifies a screen as other than asked.)
});

test('kosmos#7264 review 3: a gap, a footer that repeats, a footer that changes in place, and a laptop that sleeps', () => {
  const real = Date.now;
  const read = (ms, screen, state, fn) => {
    Date.now = () => ms;
    try {
      const board = fleet.install([fleet.agent('camille', { state, runner: 'claude', command: 'claude', screen })]);
      try { if (fn) fn(board.agents.find((c) => c.sessionName === 'camille'), board.agents); } finally { board.restore(); }
    } finally { Date.now = real; }
  };
  const row = `You've hit your session limit · resets 6pm ${Z}`;
  const block = (prompt, footer) => '❯ ' + prompt + '\n' + `  ⎿  ${row}\n` + footer;
  const old = block('hello', FOOTER);
  const day2 = Date.parse('2026-10-27T20:00:00Z');   // 15:00 CDT
  const after = Date.parse('2026-10-27T23:01:00Z');   // 18:01 CDT, the new limit's reset plus grace
  // A gap: restart at 10:00 (yesterday's row late, retired at once), the Mac asleep 13:00 to 15:00, and a new 6pm
  // limit on screen at the first capture after the gap. Capped until 18:01, not lifted at once.
  status.resetLimitFirstSeenForTests();
  const ten = Date.parse('2026-10-27T15:00:00Z');
  read(ten, old + STATUS_LINE, 'idle');
  read(Date.parse('2026-10-27T18:00:00Z'), old + STATUS_LINE, 'idle');
  read(day2, old + block('do the report', NEW_FOOTER) + STATUS_LINE, 'rate_limited');
  read(after - 60e3, old + block('do the report', NEW_FOOTER) + STATUS_LINE, 'rate_limited');
  // A footer that repeats the old one's text exactly: the extra row still moves the sighting, so it is capped.
  status.resetLimitFirstSeenForTests();
  read(ten, old + STATUS_LINE, 'idle');
  read(day2, old + block('again', FOOTER) + STATUS_LINE, 'rate_limited');
  // A footer that changes in place (the background-agents row, then the turn's own): never a hold, and capped at most
  // until the next reset, here released at once (yesterday's row, the next 6pm beyond the span from 19:20).
  status.resetLimitFirstSeenForTests();
  const r = Date.parse('2026-10-27T00:20:00Z');
  read(r, block('hello', '✻ Waiting for 1 background agent to finish\n') + STATUS_LINE, 'working');   // its agent still running
  read(r + 60e3, old + STATUS_LINE, 'idle', (card, roster) => {
    assert.equal(card.limitUntil, null, 'a footer that changed in place gave the row a time');
    assert.equal(chat.limitHeldVerdict('camille', roster, r + 60e3), null, 'and a message to it was held');
  });
  // A laptop that sleeps: captures with long gaps and the same screen. Yesterday's row stays released on every wake.
  status.resetLimitFirstSeenForTests();
  for (const t of [r, Date.parse('2026-10-27T14:00:00Z'), Date.parse('2026-10-27T16:30:00Z'), Date.parse('2026-10-27T17:55:00Z')]) {
    read(t, old + STATUS_LINE, 'idle', (card) => assert.equal(card.state, status.STATE.IDLE, 'a wake re-capped a released row'));
  }
});
