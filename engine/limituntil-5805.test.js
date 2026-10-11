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
  // CONTROLS: a dated line, a relative one and a malformed hour are not dateless resets.
  for (const bad of [`resets Oct 5 at 3pm ${Z}`, "You've hit your fast limit · resets in 4m", `resets 13pm ${Z}`, `resets 4pm (Mars/Olympus_Mons)`]) {
    assert.equal(status.limitResetTimeOnlyAt(bad, at('2026-10-10T16:00:00Z')), null, bad);
  }
});

test('#5805 slice 3: claudeLimitUntil keeps the first-seen time, so the reset does not move as time passes', () => {
  const line = `You've hit your session limit · resets 4pm ${Z}`;
  const t0 = at('2026-10-10T16:00:00Z');
  assert.equal(iso(status.claudeLimitUntil('casey', line, t0)), '2026-10-10T21:00:00.000Z');
  // Read again at 16:30 CDT, after the printed 4pm (the line stays on screen): still today's 4pm, not tomorrow's.
  assert.equal(iso(status.claudeLimitUntil('casey', line, t0 + 5.5 * 3600e3)), '2026-10-10T21:00:00.000Z', 'the reset moved with the clock');
  // CONTROL: the same line first seen by another agent at the later time reads differently (the key is the agent).
  assert.equal(status.claudeLimitUntil('leo', line, t0 + 7 * 3600e3), null);
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
