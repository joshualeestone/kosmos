'use strict';

/**
 * #5805 slice 3: a capped Claude card carries `limitUntil`, the reset its limit line printed, so the card can say
 * "Out of usage until <time>". A dated line is read as slice 1 reads it; a dateless one ("resets 4pm (zone)", the
 * 5-hour session limit and a weekly limit's last day) is its next occurrence after the board first saw the line,
 * within five hours for a session limit and a day otherwise (later than that, no time is given).
 *
 * Cards come from test-support/fleet with real limit screens (the shape status.test.js pins for #5029).
 *
 *   node --test engine/limituntil-5805.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-limituntil-5805-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const status = require('./status');
const fleet = require('../test-support/fleet');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
test.beforeEach(() => status.resetLimitFirstSeenForTests());

const Z = '(America/Chicago)';
const at = (iso) => Date.parse(iso);
const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
/* "4:35pm" for `ms` in America/Chicago: the dateless reset Claude Code prints. */
function clock(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase()}`;
}
function chicagoDay(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.month} ${p.day}`;
}
const RULE = '─'.repeat(80) + '\n';
const STATUS_LINE = RULE + '❯ \n' + RULE + '  casey · Opus 4.8 · 7d 100%\n' + '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents\n';
const limitScreen = (line) => '> hello\n' + `  ⎿  ${line}\n` + '✻ Sautéed for 0s · done 10:35 PM\n' + STATUS_LINE;

test('#5805 slice 3: a dateless reset is its next occurrence after it was first seen, within the limit\'s span', () => {
  const session = (t) => `You've hit your session limit · resets ${t} ${Z}`;
  // First seen 11:00 CDT: 4pm is that afternoon.
  assert.equal(iso(status.limitResetTimeOnlyAt(session('4pm'), at('2026-10-10T16:00:00Z'))), '2026-10-10T21:00:00.000Z');
  // First seen 17:00 CDT: the next 4pm is tomorrow, past a session limit's five hours, so no time (the board saw the line late).
  assert.equal(status.limitResetTimeOnlyAt(session('4pm'), at('2026-10-10T22:00:00Z')), null);
  // A weekly limit's last day: first seen 17:00 CDT, 3pm tomorrow is within a day.
  assert.equal(iso(status.limitResetTimeOnlyAt(`You've hit your weekly limit · resets 3pm ${Z}`, at('2026-10-10T22:00:00Z'))), '2026-10-11T20:00:00.000Z');
  // Across midnight, with minutes: first seen 23:00 CDT, 12:30am is half an hour after midnight.
  assert.equal(iso(status.limitResetTimeOnlyAt(session('12:30am'), at('2026-10-10T04:00:00Z'))), '2026-10-10T05:30:00.000Z');
  // The minute's grace: first seen 30 seconds after the printed minute (seconds are dropped), it is that minute.
  assert.equal(iso(status.limitResetTimeOnlyAt(session('4pm'), at('2026-10-10T21:00:30Z'))), '2026-10-10T21:00:00.000Z');
  // Across the fall-back change (Nov 1 2026, 2am CDT -> 1am CST): first seen 23:00 CDT Oct 31, 3am is CST, five
  // hours on (the repeated hour counts), not four.
  assert.equal(iso(status.limitResetTimeOnlyAt(session('3am'), at('2026-11-01T04:00:00Z'))), '2026-11-01T09:00:00.000Z');
  // The hour the fall-back repeats (1:30am happens twice on Nov 1 2026): the later one, as limitResetAt reads it.
  assert.equal(iso(status.limitResetTimeOnlyAt(session('1:30am'), at('2026-11-01T04:00:00Z'))), '2026-11-01T07:30:00.000Z');
  // CONTROLS: a dated line, a relative one and a malformed hour are not dateless resets.
  for (const bad of [`resets Oct 5 at 3pm ${Z}`, "You've hit your fast limit · resets in 4m", `resets 13pm ${Z}`, `resets 4pm (Mars/Olympus_Mons)`]) {
    assert.equal(status.limitResetTimeOnlyAt(bad, at('2026-10-10T16:00:00Z')), null, bad);
  }
});

test('#5805 slice 3: claudeLimitUntil keeps the first-seen time, so the reset does not move as time passes', () => {
  const line = `You've hit your session limit · resets 4pm ${Z}`;
  const t0 = at('2026-10-10T16:00:00Z');
  assert.equal(iso(status.claudeLimitUntil('casey', line, t0)), '2026-10-10T21:00:00.000Z');
  // Read again at 16:30 CDT after a gap in reads (the Mac slept through the reset, the line still on screen): still
  // today's 4pm, not tomorrow's (review 1: a gap in reads is not the line going away).
  assert.equal(iso(status.claudeLimitUntil('casey', line, t0 + 5.5 * 3600e3)), '2026-10-10T21:00:00.000Z', 'the reset moved with the clock');
  // A weekly last-day line across a sleep through its reset: still today's time, never tomorrow's.
  const weekly = `You've hit your weekly limit · resets 3pm ${Z}`;
  // (Another agent: a second line on casey's screen would itself end casey's first limit.)
  assert.equal(iso(status.claudeLimitUntil('april', weekly, at('2026-10-10T19:00:00Z'))), '2026-10-10T20:00:00.000Z');
  assert.equal(iso(status.claudeLimitUntil('april', weekly, at('2026-10-10T20:30:00Z'))), '2026-10-10T20:00:00.000Z', 'a sleep through the reset named tomorrow');
  // CONTROL: the key is the agent. A weekly last-day line first seen by casey at 14:00 CDT is today's 3pm; the same
  // words first seen by leo at 15:30 CDT are tomorrow's (within a day), never casey's time.
  const wk = `You've hit your weekly limit · resets 3pm ${Z}`;
  assert.equal(iso(status.claudeLimitUntil('kim', wk, at('2026-10-10T19:00:00Z'))), '2026-10-10T20:00:00.000Z');
  assert.equal(iso(status.claudeLimitUntil('leo', wk, at('2026-10-10T20:30:00Z'))), '2026-10-11T20:00:00.000Z', 'another agent\'s first-seen time was used');
  // One reading that is not capped (a failed pane read, a moment in another state) does not end the limit: the same
  // line read again keeps its first-seen time (review 2). Readings come through the real card builder.
  const idleRead = (ms) => {
    const real = Date.now;
    Date.now = () => ms;
    try { fleet.install([fleet.agent('casey', { state: 'idle', runner: 'claude', command: 'claude', screen: STATUS_LINE })]).restore(); }
    finally { Date.now = real; }
  };
  idleRead(t0 + 5.6 * 3600e3);
  assert.equal(iso(status.claudeLimitUntil('casey', line, t0 + 5.7 * 3600e3)), '2026-10-10T21:00:00.000Z', 'one reading not capped ended the limit');
  // Read not capped for two minutes and more (two idle readings three minutes apart): the limit ended, so the same
  // words the next day are a new limit.
  idleRead(t0 + 6 * 3600e3);
  idleRead(t0 + 6 * 3600e3 + 3 * 60e3);
  const nextDay = at('2026-10-11T16:00:00Z');
  assert.equal(iso(status.claudeLimitUntil('casey', line, nextDay)), '2026-10-11T21:00:00.000Z', 'read against yesterday\'s first-seen time');
  // A line with no reset this reads (a relative one) is another limit too.
  const fresh = at('2026-10-13T17:00:00Z');
  status.claudeLimitUntil('casey', line, fresh);
  status.claudeLimitUntil('casey', "You've hit your fast limit · resets in 4m", fresh + 60e3);
  assert.equal(iso(status.claudeLimitUntil('casey', line, at('2026-10-14T17:00:00Z'))), '2026-10-14T21:00:00.000Z', 'an unread line between did not end the dateless limit');
  // A dated line on the screen is another limit too: after it, the dateless words are read afresh.
  status.claudeLimitUntil('casey', `You've hit your weekly limit · resets Oct 14 at 3pm ${Z}`, nextDay + 60e3);
  assert.equal(iso(status.claudeLimitUntil('casey', line, at('2026-10-12T17:00:00Z'))), '2026-10-12T21:00:00.000Z', 'a dated limit between did not end the dateless one');
  // A dated line needs no first-seen time.
  assert.equal(iso(status.claudeLimitUntil('casey', `You've hit your weekly limit · resets Oct 12 at 3pm ${Z}`, t0)), '2026-10-12T20:00:00.000Z');
  assert.equal(status.claudeLimitUntil('casey', 'Looks like nothing', t0), null);
});

test('#5805 slice 3: the card carries limitUntil for a capped Claude agent, dated or dateless, and null otherwise', () => {
  const now = Date.now();
  const soon = now + 2 * 3600e3;
  const cases = [
    ['dateless', limitScreen(`You've hit your session limit · resets ${clock(soon)} ${Z}`), 'rate_limited', (v) => {
      const ms = Date.parse(v);
      assert.ok(ms <= soon && ms > soon - 60e3, 'a dateless reset two hours ahead read as ' + v);
    }],
    ['dated', limitScreen(`You've hit your weekly limit · resets ${chicagoDay(now + 3 * 86400e3)} at 3pm ${Z}`), 'rate_limited', (v) => {
      assert.ok(Date.parse(v) > now + 2 * 86400e3, 'a dated reset three days ahead read as ' + v);
    }],
    ['idle (CONTROL)', STATUS_LINE, 'idle', (v) => assert.equal(v, null)],
  ];
  for (const [label, screen, state, check] of cases) {
    status.resetLimitFirstSeenForTests();
    const board = fleet.install([fleet.agent('casey', { state, runner: 'claude', command: 'claude', screen })]);
    try {
      const card = board.agents.find((c) => c.sessionName === 'casey');
      assert.equal(card.state, state, label);
      assert.ok('limitUntil' in card, label + ': the card has no limitUntil field');
      check(card.limitUntil);
    } finally { board.restore(); }
  }
});

test('#5805 slice 3: through the card builder, a capped reading between two stray ones keeps the limit (review 3)', () => {
  // Every reading goes through the real card builder at a set clock. The limit is first seen at T with its reset at
  // T+1h; the line stays on screen past the reset. Stray not-capped readings at T+0.6h and T+1.6h have a capped
  // reading between them, so they are a minute apart in no sense that matters: the limit must survive both. Were the
  // capped reading not to clear the first stray one, the second would end the limit at T+1.6h and the clock would
  // restart past the reset (a session limit then names no time).
  const real = Date.now;
  const T = Math.floor(real() / 60e3) * 60e3;
  const line = `You've hit your session limit · resets ${clock(T + 3600e3)} ${Z}`;
  const read = (ms, capped) => {
    Date.now = () => ms;
    try {
      const board = fleet.install([fleet.agent('dana', capped
        ? { state: 'rate_limited', runner: 'claude', command: 'claude', screen: limitScreen(line) }
        : { state: 'idle', runner: 'claude', command: 'claude', screen: STATUS_LINE })]);
      try { return board.agents.find((c) => c.sessionName === 'dana').limitUntil; } finally { board.restore(); }
    } finally { Date.now = real; }
  };
  const first = read(T, true);
  assert.ok(first && Math.abs(Date.parse(first) - (T + 3600e3)) < 60e3, 'CONTROL: first seen with its reset an hour on: ' + first);
  read(T + 0.6 * 3600e3, false);
  assert.equal(read(T + 1.5 * 3600e3, true), first, 'one stray reading ended the limit');
  read(T + 1.6 * 3600e3, false);
  assert.equal(read(T + 1.7 * 3600e3, true), first, 'a stray reading an hour after an earlier one ended the limit');
  // CONTROL: two stray readings three minutes apart with nothing capped between do end it.
  read(T + 1.8 * 3600e3, false);
  read(T + 1.85 * 3600e3, false);
  assert.equal(read(T + 1.9 * 3600e3, true), null, 'the limit did not end after two minutes not capped');
});
