'use strict';
/**
 * kosmos#7365 slice 3b: the room archive on the page. The page's own pjArchBefore (the confirm's time, in the person's
 * zone, sent with Z), pjArchReceipt (the line naming the time the server used) and pjWinAtStart (the boundary row shows
 * only when the window holds the live history back to its start) run here. The whole flow on a real board is
 * docs/browser-checks/render-room-archive-7365.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scriptOf, liftAll, liftConst } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const SRC = [liftConst(SCRIPT, 'PJ_WIN'), liftAll(SCRIPT, ['pjArchBefore', 'pjArchReceipt', 'pjWinAtStart'])].join('\n');
function page(extra = {}) {
  const ctx = vm.createContext({ PJ_CURRENT: 'p1', Date, Number, Array, ...extra });
  vm.runInContext(SRC + '\nthis.PJ_WIN = PJ_WIN; this.pjArchBefore = pjArchBefore; this.pjArchReceipt = pjArchReceipt; this.pjWinAtStart = pjWinAtStart;', ctx);
  return ctx;
}

test('#7365 3b: this week and this month are 7 and 30 calendar days back, everything before today is local midnight', () => {
  const { pjArchBefore } = page();
  const now = new Date(2026, 9, 27, 16, 45, 12, 345);   // local time, whatever the runner's zone
  const week = new Date(pjArchBefore('week', now));
  assert.equal(week.getDate(), new Date(2026, 9, 20).getDate());
  assert.equal(week.getHours(), 16);
  assert.equal(week.getMinutes(), 45);
  const month = new Date(pjArchBefore('month', now));
  assert.equal(month.getTime(), new Date(2026, 8, 27, 16, 45, 12, 345).getTime());
  const today = new Date(pjArchBefore('today', now));
  assert.equal(today.getTime(), new Date(2026, 9, 27, 0, 0, 0, 0).getTime());
  // Sent as ISO with Z: the server refuses a time with no zone.
  assert.match(pjArchBefore('today', now), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('#7365 3b: an unknown choice sends nothing, and the time is computed from the clock passed in, not changed in place', () => {
  const { pjArchBefore } = page();
  const now = new Date(2026, 9, 27, 16, 45);
  const before = now.getTime();
  assert.equal(pjArchBefore('year', now), null);
  assert.equal(pjArchBefore(undefined, now), null);
  pjArchBefore('today', now);
  assert.equal(now.getTime(), before);
});

test('#7365 3b: the receipt names the time the server answered with, and an unreadable one says less, not something wrong', () => {
  const { pjArchReceipt } = page();
  const used = new Date(2026, 9, 26, 16, 10).toISOString();
  const line = pjArchReceipt(used);
  assert.match(line, /^Messages before .+, .+ are archived\. Undo is in the archive\.$/);
  const d = new Date(used);
  assert.ok(line.includes(d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })), line);
  assert.equal(pjArchReceipt(undefined), 'Older messages are archived.');
  assert.equal(pjArchReceipt('not a time'), 'Older messages are archived.');
});

test('#7365 3b: the boundary row condition holds only at the start of the live history of the room on screen', () => {
  const ctx = page();
  const W = ctx.PJ_WIN;
  Object.assign(W, { pid: 'p1', newest: [], older: [], newestOlder: 0, olderCount: 0 });
  assert.equal(ctx.pjWinAtStart(), true);
  W.newestOlder = 5;   // the newest page does not reach the start
  assert.equal(ctx.pjWinAtStart(), false);
  W.older = [{}]; W.olderCount = 0;   // an earlier page was read back to the start: olderCount decides, not newestOlder
  assert.equal(ctx.pjWinAtStart(), true);
  W.olderCount = 3;
  assert.equal(ctx.pjWinAtStart(), false);
  Object.assign(W, { older: [], newestOlder: 0 });
  W.newest = null;   // nothing read yet
  assert.equal(ctx.pjWinAtStart(), false);
  W.newest = []; W.pid = 'p2';   // the window belongs to another room
  assert.equal(ctx.pjWinAtStart(), false);
});
