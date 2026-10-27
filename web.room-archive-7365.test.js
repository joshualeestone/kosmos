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

test('#7365 3b: this week and this month are 7 and 30 calendar days back, everything older than a day is 24 hours back', () => {
  const { pjArchBefore } = page();
  const now = new Date(2026, 9, 27, 16, 45, 12, 345);   // local time, whatever the runner's zone
  const week = new Date(pjArchBefore('week', now));
  assert.equal(week.getDate(), new Date(2026, 9, 20).getDate());
  assert.equal(week.getHours(), 16);
  assert.equal(week.getMinutes(), 45);
  const month = new Date(pjArchBefore('month', now));
  assert.equal(month.getTime(), new Date(2026, 8, 27, 16, 45, 12, 345).getTime());
  // Not local midnight (review 1): the server keeps the last day live, so midnight would always become 24 hours back.
  assert.equal(Date.parse(pjArchBefore('day', now)), now.getTime() - 24 * 60 * 60 * 1000);
  assert.equal(pjArchBefore('today', now), null);
  // Sent as ISO with Z: the server refuses a time with no zone.
  assert.match(pjArchBefore('day', now), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('#7365 3b: an unknown choice sends nothing, and the time is computed from the clock passed in, not changed in place', () => {
  const { pjArchBefore } = page();
  const now = new Date(2026, 9, 27, 16, 45);
  const before = now.getTime();
  assert.equal(pjArchBefore('year', now), null);
  assert.equal(pjArchBefore(undefined, now), null);
  pjArchBefore('day', now);
  pjArchBefore('week', now);
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

test('#7365 3b review 1: resetting the window does not close the archive (the poll resets it when a gap read does not join)', () => {
  const src = liftAll(SCRIPT, ['pjWinReset']);
  let closed = 0, lines = 0;
  const ctx = vm.createContext({ pjArchReset: () => { closed += 1; }, PJ_ARCH: {}, pjWinOlderLine: () => { lines += 1; } });
  vm.runInContext(liftConst(SCRIPT, 'PJ_WIN') + '\n' + src + '\nthis.PJ_WIN = PJ_WIN; this.pjWinReset = pjWinReset;', ctx);
  Object.assign(ctx.PJ_WIN, { archivedCount: 260, archiveMarker: { before: 'x' } });
  ctx.pjWinReset('p1');
  assert.equal(closed, 0);
  assert.equal(lines, 1);
  // and the archive's count and marker go with the window, so a stale Undo cannot show
  assert.equal(ctx.PJ_WIN.archivedCount, 0);
  assert.equal(ctx.PJ_WIN.archiveMarker, null);
});

test('#7365 3b review 1: the live read leaves the archive count to loadRoom, after its generation check', () => {
  const src = liftAll(SCRIPT, ['pjWinRead']);
  assert.doesNotMatch(src, /archivedCount|archiveMarker/);
  const load = liftAll(SCRIPT, ['loadRoom']);
  const gen = load.indexOf('win !== PJ_WIN.gen) return;');
  const set = load.indexOf('PJ_WIN.archivedCount = Number(body.archivedCount)');
  assert.ok(gen > 0 && set > gen, 'the count is stored after the generation check');
});

test('#7365 3b review 1: paintRoom keeps its state and hold strip running while the archive is open, and skips only the rows', () => {
  const src = liftAll(SCRIPT, ['paintRoom']);
  const stop = src.indexOf("if (typeof PJ_ARCH !== 'undefined' && pjArchShowing()) return;");
  assert.ok(stop > 0, 'the archive return is there');
  for (const before of ['ROOM_SPOKE_AT.set(', 'PJ_ROOM_POSTS = new Map(', 'PJ_ROOM_HELD = ', "getElementById('pj-held')"]) {
    const at = src.indexOf(before);
    assert.ok(at > 0 && at < stop, before + ' runs before the archive return');
  }
  for (const after of ['paintThreadInto(box', 'pjMarkSeen(', 'unreadEdgeApply(box']) {
    const at = src.indexOf(after);
    assert.ok(at > stop, after + ' is skipped while the archive is open');
  }
});
