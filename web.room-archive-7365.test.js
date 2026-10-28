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
const SRC = [liftConst(SCRIPT, 'PJ_WIN'), liftAll(SCRIPT, ['pjArchBefore', 'pjRoomArchWhen', 'pjArchReceipt', 'pjWinAtStart', 'pjRoomTopEdge'])].join('\n');
function page(extra = {}) {
  const ctx = vm.createContext({ PJ_CURRENT: 'p1', Date, Number, Array, ...extra });
  vm.runInContext(SRC + '\nthis.PJ_WIN = PJ_WIN; this.pjArchBefore = pjArchBefore; this.pjArchReceipt = pjArchReceipt; this.pjWinAtStart = pjWinAtStart; this.pjRoomTopEdge = pjRoomTopEdge;', ctx);
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
  assert.match(line, /^Messages before .+, .+ are archived\. You can put them back from the archive\.$/);
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
  // and after the gap block, whose reset would zero it for a poll (review 2; review 3 found this pin missing)
  const reset = load.lastIndexOf('pjWinReset(PJ_CURRENT)');
  assert.ok(reset > 0 && set > reset, 'the count is stored after the last window reset in loadRoom');
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

test('#7365 3b review 2: every top-level function in the page is declared once (a second declaration silently replaces the first)', () => {
  // Found in review 2's fixes: a new pjArchWhen replaced the archived-projects list's own pjArchWhen, with no error.
  const names = [...SCRIPT.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]);
  assert.ok(names.length > 1000, 'the declaration scan found only ' + names.length + '; it has stopped seeing them');
  const seen = new Set(), twice = new Set();
  for (const n of names) (seen.has(n) ? twice : seen).add(n);
  assert.deepEqual([...twice], []);
});

/* The archive view's own functions, run against a fake room panel and a fake paged read. */
function archPage({ reads }) {
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, hidden: id === 'pj-arch-head', textContent: '', innerHTML: '', scrollTop: 0, scrollHeight: 1000,
    classList: { on: new Set(), add(c) { this.on.add(c); }, remove(c) { this.on.delete(c); }, toggle(c, v) { if (v) this.on.add(c); else this.on.delete(c); }, contains(c) { return this.on.has(c); } },
    focus() { doc.activeElement = this; }, parentNode: null, closest: () => null });
  const doc = { activeElement: null, getElementById: el };
  const said = [], toasts = [], painted = [], restored = [];
  const ctx = vm.createContext({
    document: doc, PJ_CURRENT: 'p1', PJ_ROOM_QUERY: '', PJ_WIN_PAGE: 200, Number, Array, Map, Object, JSON, Promise,
    pjById: () => ({ id: 'p1', agents: [] }), pjRoomRow: (m) => '<div class="msg">' + m.text + '</div>',
    threadAnchor: () => ({ mid: 'm-live' }), restoreThreadAnchor: (b, a) => restored.push(a),
    paintRoom: (body) => painted.push(body), pjRoomAnnounce: (t) => said.push(t), msgToast: (t) => toasts.push(t),
    pjWinMerge: (older, page) => older.concat(page),
    pjWinRead: (pid, n, cursor, archive) => { const r = reads.shift(); return typeof r === 'function' ? r({ pid, n, cursor, archive }) : r; },
  });
  vm.runInContext([liftConst(SCRIPT, 'PJ_WIN'), liftConst(SCRIPT, 'PJ_ARCH'),
    liftAll(SCRIPT, ['pjArchReset', 'pjArchComposer', 'pjArchShowing', 'pjArchState', 'pjArchHead', 'paintArch', 'pjArchOpen', 'pjArchEarlier', 'pjArchClose', 'pjWinOlderLine', 'pjWinNoteReactions'])].join('\n')
    + '\nthis.PJ_WIN = PJ_WIN; this.PJ_ARCH = PJ_ARCH; this.pjArchOpen = pjArchOpen; this.pjArchEarlier = pjArchEarlier; this.pjArchClose = pjArchClose; this.pjWinNoteReactions = pjWinNoteReactions;', ctx);
  el('pj-room').__lastBody = { rows: [{ text: 'live' }] };
  return { ctx, el, doc, said, toasts, painted, restored };
}
const page1 = { rows: [{ kind: 'post', id: 'a1', text: 'archived one' }], olderCursor: 'c1', olderCount: 5, archivedCount: 6, archiveMarker: { before: '2026-10-20T00:00:00.000Z' } };

test('#7365 3b review 2: opening the archive paints its page, moves focus to Back and says so; Back restores the room and the place', async () => {
  const h = archPage({ reads: [page1] });
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1', archiveMarker: { before: 'x' } });
  await h.ctx.pjArchOpen();
  assert.equal(h.ctx.PJ_ARCH.on, true);
  assert.match(h.el('pj-room').innerHTML, /archived one/);
  assert.equal(h.el('pj-arch-head').hidden, false);
  assert.equal(h.el('pj-arch-undo').hidden, false);
  assert.equal(h.doc.activeElement && h.doc.activeElement.id, 'pj-arch-back');
  assert.match(h.said.join('|'), /^Showing the archive, 6 messages\.$/);
  h.doc.activeElement = { closest: (sel) => (sel === '#pj-arch-head' ? {} : null) };
  h.ctx.pjArchClose();
  assert.equal(h.ctx.PJ_ARCH.on, false);
  assert.equal(h.painted.length, 1, 'the live room is painted from its last body');
  assert.deepEqual(h.restored, [{ mid: 'm-live' }], 'the reader is put back on the message they left from');
  assert.equal(h.doc.activeElement.id, 'pj-post');
  assert.equal(h.said[h.said.length - 1], 'Back in the room.');
});

test('#7365 3b review 2: a stale archive read never lands over a newer one, and a second press while one is out does nothing', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const h = archPage({ reads: [() => slow, page1] });
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1' });
  const first = h.ctx.pjArchOpen();
  await h.ctx.pjArchOpen();   // a second press while the first read is out
  assert.equal(h.el('pj-room-older-text').textContent, 'Opening the archive…');
  h.ctx.PJ_ARCH.gen += 1;   // the archive was closed and opened again meanwhile
  release({ rows: [{ kind: 'post', id: 'old', text: 'stale page' }], olderCount: 0, archivedCount: 1 });
  await first;
  assert.doesNotMatch(h.el('pj-room').innerHTML, /stale page/);
});

test('#7365 3b review 2: a failed earlier archive page says so on the line with Try again, and clearing it reads again', async () => {
  const h = archPage({ reads: [page1, null, { rows: [{ kind: 'post', id: 'a0', text: 'earlier one' }], olderCount: 0 }] });
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1' });
  await h.ctx.pjArchOpen();
  await h.ctx.pjArchEarlier();   // the read answers null: pjWinRead threw or failed
  assert.equal(h.ctx.PJ_ARCH.because, 'We could not read the earlier archived messages.');
  assert.equal(h.el('pj-room-older-text').textContent, 'We could not read the earlier archived messages.');
  assert.equal(h.el('pj-room-older-show').hidden, false, 'Try again shows');
  await h.ctx.pjArchEarlier();   // a scroll does not retry by itself
  assert.equal(h.ctx.PJ_ARCH.rows.length, 1);
  h.ctx.PJ_ARCH.because = null;   // what Try again does
  await h.ctx.pjArchEarlier();
  assert.equal(h.ctx.PJ_ARCH.rows.length, 2);
  assert.equal(h.el('pj-room-older-show').hidden, true);
  assert.match(h.el('pj-room').innerHTML, /This is the start of the room\./);
});

test('#7365 3b review 3: a reaction made inside the archive is still on its row after the next archive page lands', async () => {
  const h = archPage({ reads: [page1, { rows: [{ kind: 'post', id: 'a0', text: 'earlier one' }], olderCount: 0 }] });
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1', older: [], newest: [] });
  await h.ctx.pjArchOpen();
  h.ctx.pjWinNoteReactions('p1', 'a1', [{ emoji: 'x', by: ['you'] }], null);
  await h.ctx.pjArchEarlier();
  const row = h.ctx.PJ_ARCH.rows.find((r) => r.id === 'a1');
  assert.deepEqual(row.reactions, [{ emoji: 'x', by: ['you'] }]);
  assert.ok(h.ctx.PJ_ARCH.posts.get('a1').reactions, 'and the archive post map a reply reads');
});

test('#7365 3b review 3: what Archive says depends on the count before and after, never on the total alone', () => {
  const ctx = vm.createContext({ Date, Number });
  vm.runInContext(liftAll(SCRIPT, ['pjRoomArchWhen', 'pjArchReceipt', 'pjArchOutcome']) + '\nthis.f = pjArchOutcome;', ctx);
  const t = new Date(2026, 9, 26, 16, 10).toISOString();
  assert.match(ctx.f(0, 260, t), /^Messages before .+, .+ are archived\. You can put them back from the archive\.$/);
  assert.match(ctx.f(260, 10, t), /^Messages before .+ are archived; newer ones you had archived are back in the room\.$/);
  assert.match(ctx.f(260, 260, t), /^Nothing more in this room was old enough to archive \(before .+\)\.$/);
  assert.equal(ctx.f(0, 0, undefined), 'Nothing more in this room was old enough to archive.');
  assert.equal(ctx.f(0, 5, undefined), 'Older messages are archived. You can put them back from the archive.');
  assert.equal(ctx.f(NaN, 5, undefined), 'The archive is set. You can put them back from the archive.');
  assert.match(ctx.f(NaN, NaN, t), /^Messages before .+ are archived\. You can put them back from the archive\.$/);
  for (const x of [ctx.f(0, 0, undefined), ctx.f(NaN, 3, ''), ctx.f(1, 2, 'bad')]) assert.doesNotMatch(x, /  |\( /, 'no hole where a time would be: ' + x);
});

test('#7365 3b review 4: the Undo sentence states the server\'s own archive rule, so the two cannot drift apart', () => {
  const roomarchive = require('./engine/roomarchive');
  const days = roomarchive.ARCHIVE_AGE_MS / (24 * 60 * 60 * 1000);
  const keep = roomarchive.ARCHIVE_KEEP.toLocaleString('en-US');
  const said = SCRIPT.match(/msgToast\('Put back\. Messages you archived are back in the room; any older than (\d+) days and past the newest ([\d,]+) stay archived\.'\)/);
  assert.ok(said, 'the Undo sentence was not found');
  assert.equal(Number(said[1]), days);
  assert.equal(said[2], keep);
});

/* The confirm itself (pjArchAsk), run against fake controls and a scripted board: each fetch answers from `answers`. */
function askPage({ answers, current = 'p1', projects = { p1: { id: 'p1', name: 'Alpha' } } }) {
  const els = {};
  const listeners = [];
  const doc = {
    activeElement: null, visibilityState: 'visible',
    getElementById: (id) => els[id] || (els[id] = { id, hidden: id === 'pjarch-modal', disabled: false, value: 'week', textContent: '', onclick: null, onchange: null,
      focus() { doc.activeElement = this; }, setAttribute() {}, getClientRects: () => [1], closest: () => null }),
    addEventListener: (t, f) => listeners.push(f), removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
  };
  const toasts = [], loads = [], calls = [];
  const ctx = vm.createContext({
    document: doc, Date, Number, JSON, Promise,
    PJ_CURRENT: current, PJ_ARCH: { on: false }, pjById: (id) => projects[id] || null,
    msgToast: (t) => toasts.push(t), pjRoomAnnounce: () => {}, pjArchReset: () => calls.push('reset'), pjArchClose: () => calls.push('close'),
    pjArchAfter: (before) => { calls.push(['after', before]); loads.push(ctx.PJ_CURRENT); },
    pjWinReset: () => calls.push('winreset'), loadRoom: () => loads.push(ctx.PJ_CURRENT),
    pjArchAskShown: () => doc.getElementById('pj-arch-ask'),   // the header's link (this fake document has no layout)
    fetch: async (url, opt) => { const a = answers.shift(); calls.push((opt && opt.method) || 'GET'); return typeof a === 'function' ? a(url, opt) : a; },
  });
  vm.runInContext([liftAll(SCRIPT, ['pjArchBefore', 'pjRoomArchWhen', 'pjArchReceipt', 'pjArchOutcome', 'pjArchCount', 'pjArchAsk']),
    'let PJ_ARCH_ASK_CLOSE = null; let PJ_ARCH_ASK_GEN = 0;',
    'this.ask = pjArchAsk; this.closeFromProject = () => PJ_ARCH_ASK_CLOSE && PJ_ARCH_ASK_CLOSE(); this.gen = () => PJ_ARCH_ASK_GEN;'].join('\n'), ctx);
  return { ctx, doc, el: doc.getElementById, toasts, loads, calls, listeners };
}
const count = (n) => ({ ok: true, json: async () => ({ archivedCount: n }) });
const marked = { ok: true, json: async () => ({ ok: true, marker: { before: new Date(2026, 9, 20, 18, 0).toISOString() } }) };

test('#7365 3b review 5: opening another project closes the confirm without moving focus, and the outcome is still said, by name', async () => {
  let answer;
  const slowPost = () => new Promise((r) => { answer = r; });
  const h = askPage({ answers: [count(0), slowPost, count(260)] });
  h.ctx.ask();
  const press = h.el('pjarch-go').onclick();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.el('pjarch-when').disabled, true, 'the choice is locked while the request is out');
  const other = { id: 'elsewhere' };
  h.doc.activeElement = other;   // the person is in the other project now
  const before = h.ctx.gen();
  h.ctx.closeFromProject();
  assert.equal(h.el('pjarch-modal').hidden, true);
  assert.ok(h.ctx.gen() > before, 'the opening is over: a late answer cannot act on a later confirm');
  assert.equal(h.doc.activeElement, other, 'focus stays where the person put it');
  assert.equal(h.listeners.length, 0, 'no key listener is left behind');
  h.ctx.PJ_CURRENT = 'p2';
  answer(marked);
  await press;
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0], /^In Alpha: Messages before .+ are archived\. You can put them back from the archive\.$/);
  assert.deepEqual(h.loads, [], 'the room on screen is another one, so nothing reloads');
});

test('#7365 3b reviews 5-7: a successful Archive hands the server\'s own cutoff to pjArchAfter, on the confirm and on the project-switch path', async () => {
  const h = askPage({ answers: [count(0), marked, count(260)] });
  h.ctx.ask();
  await h.el('pjarch-go').onclick();
  const after = h.calls.find((c) => Array.isArray(c) && c[0] === 'after');
  assert.ok(after, JSON.stringify(h.calls));
  assert.equal(after[1], new Date(2026, 9, 20, 18, 0).toISOString(), 'the time the server answered with, not the one asked');
  // The project-switch path, with the room back on screen when the answer lands.
  let answer;
  const k = askPage({ answers: [count(0), () => new Promise((r) => { answer = r; }), count(260)] });
  k.ctx.ask();
  const press = k.el('pjarch-go').onclick();
  await new Promise((r) => setImmediate(r));
  k.ctx.closeFromProject();
  answer(marked);
  await press;
  assert.ok(k.calls.some((c) => Array.isArray(c) && c[0] === 'after' && c[1] === new Date(2026, 9, 20, 18, 0).toISOString()), JSON.stringify(k.calls));
});

test('#7365 3b review 7: after Archive, rows older than the cutoff leave the live room at once, whether or not the archive was open', () => {
  for (const open of [true, false]) {
    const painted = [];
    const box = { __lastBody: { ok: true, rows: [{ id: 'old', at: '2026-10-01T00:00:00.000Z' }, { id: 'new', at: '2026-10-27T00:00:00.000Z' }, { id: 'undated' }] }, classList: { remove() {}, add() {} } };
    const ctx = vm.createContext({ Date, Number, Array, Object, JSON,
      document: { getElementById: (id) => (id === 'pj-room' ? box : null) },
      PJ_ARCH: { on: open }, PJ_CURRENT: 'p1',
      pjArchClose: (q, f, s2, before) => { ctx.pjRoomDropArchived(box, before); painted.push(box.__lastBody.rows.map((r) => r.id)); },
      pjArchReset: () => {}, paintRoom: (b) => painted.push(b.rows.map((r) => r.id)), pjWinReset: () => {}, loadRoom: () => painted.push('load') });
    vm.runInContext(liftConst(SCRIPT, 'PJ_WIN') + '\n' + liftAll(SCRIPT, ['pjRoomDropArchived', 'pjArchAfter']) + '\nthis.PJ_WIN = PJ_WIN; this.pjRoomDropArchived = pjRoomDropArchived; this.after = pjArchAfter;', ctx);
    Object.assign(ctx.PJ_WIN, { older: [{ id: 'o-old', at: '2026-09-01T00:00:00.000Z' }, { id: 'o-new', at: '2026-10-27T01:00:00.000Z' }], newest: [] });
    ctx.after('2026-10-20T00:00:00.000Z');
    assert.deepEqual(painted, [['new', 'undated'], 'load'], (open ? 'archive open: ' : 'archive closed: ') + JSON.stringify(painted));
    assert.deepEqual(ctx.PJ_WIN.older.map((r) => r.id), ['o-new']);
  }
});

test('#7365 3b review 5: Back marks the room seen before painting it, and a search closing the archive does not', async () => {
  const h = archPage({ reads: [page1, page1] });
  const seen = [];
  h.ctx.pjMarkSeen = (pid) => seen.push(['seen', pid]);
  h.doc.visibilityState = 'visible';
  const paint = h.ctx.paintRoom; h.ctx.paintRoom = (b) => { seen.push(['paint']); paint(b); };
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1' });
  await h.ctx.pjArchOpen();
  h.ctx.pjArchClose();
  assert.deepEqual(seen, [['seen', 'p1'], ['paint']]);
  seen.length = 0;
  await h.ctx.pjArchOpen();
  h.ctx.pjArchClose(true, undefined, true);   // the search's close
  assert.deepEqual(seen, [['paint']]);
});

test('#7365 3b review 5: when every archived message comes back, the outcome does not say anything is archived', () => {
  const ctx = vm.createContext({ Date, Number });
  vm.runInContext(liftAll(SCRIPT, ['pjRoomArchWhen', 'pjArchReceipt', 'pjArchOutcome']) + '\nthis.f = pjArchOutcome;', ctx);
  const t = new Date(2026, 9, 26, 16, 10).toISOString();
  assert.match(ctx.f(260, 0, t), /^Nothing in this room is older than .+; the messages you had archived are back in the room\.$/);
  assert.match(ctx.f(260, 10, t), /^Messages before .+ are archived; newer ones you had archived are back in the room\.$/);
});

test('#7365 3b review 6: Undo landing while a reopened archive is still reading reads it again, and the older read never lands', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const fresh = { rows: [{ kind: 'post', id: 'f1', text: 'after undo' }], olderCount: 0, archivedCount: 1 };
  const h = archPage({ reads: [() => slow, fresh] });
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1' });
  const first = h.ctx.pjArchOpen();
  h.ctx.PJ_ARCH.anchor = { mid: 'kept' };
  await h.ctx.pjArchOpen(true);   // what Undo does for a view reopened meanwhile
  assert.match(h.el('pj-room').innerHTML, /after undo/);
  assert.deepEqual(h.ctx.PJ_ARCH.anchor, { mid: 'kept' }, 'the live room\'s anchor from the first opening is kept');
  release({ rows: [{ kind: 'post', id: 'old', text: 'before undo' }], olderCount: 0, archivedCount: 260 });
  await first;
  assert.doesNotMatch(h.el('pj-room').innerHTML, /before undo/);
});

test('#7365 3b review 7: closing the archive after Archive paints the live room without the rows just archived, never blank', async () => {
  const h = archPage({ reads: [page1] });
  h.ctx.pjRoomDropArchived = (box, before) => { const cut = Date.parse(before); box.__lastBody = Object.assign({}, box.__lastBody, { rows: box.__lastBody.rows.filter((r) => !(Date.parse(r.at) < cut)) }); };
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1' });
  h.el('pj-room').__lastBody = { rows: [{ text: 'gone', at: '2026-10-01T00:00:00.000Z' }, { text: 'kept', at: '2026-10-27T00:00:00.000Z' }] };
  await h.ctx.pjArchOpen();
  h.ctx.pjArchClose(true, false, false, '2026-10-20T00:00:00.000Z');
  assert.equal(h.painted.length, 1);
  assert.deepEqual(h.painted[0].rows.map((r) => r.text), ['kept']);
  assert.equal(h.restored.length, 1, 'the reader\'s place is restored too');
});

test('#7365 3b review 6: the confirm closing because its box left the screen still says the outcome', async () => {
  let answer;
  const h = askPage({ answers: [count(0), () => new Promise((r) => { answer = r; }), count(260)] });
  h.ctx.ask();
  const press = h.el('pjarch-go').onclick();
  await new Promise((r) => setImmediate(r));
  h.el('pjarch-modal').getClientRects = () => [];   // the room's section was hidden some other way
  h.listeners.slice().forEach((f) => f({ key: 'Tab', preventDefault() {} }));
  assert.equal(h.listeners.length, 0, 'it closed and let go of the keyboard');
  answer(marked);
  await press;
  assert.match(h.toasts.join('|'), /^In Alpha: Messages before .+ are archived\./);
});

test('#7365 3b review 7: the archive header describes the rows under it; an archive changed elsewhere reads the archive again', async () => {
  const h = archPage({ reads: [page1] });
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1', archiveMarker: { before: 'x' }, newest: [], archivedCount: 2 });
  await h.ctx.pjArchOpen();
  assert.equal(h.el('pj-arch-count').textContent, '6 messages', 'the page\'s own count, not an older live read');
  const src = liftAll(SCRIPT, ['loadRoom']);
  const again = src.indexOf('pjArchState(PJ_WIN.archivedCount, PJ_WIN.archiveMarker)) pjArchOpen(true)');
  assert.ok(again > src.indexOf('PJ_WIN.archiveMarker = body.archiveMarker'), 'compared with the archive\'s own read after the live read is stored, reading the archive again');
  assert.ok(src.indexOf('PJ_ARCH.readAs !== pjArchState(') > 0, 'compared with what the archive was read under, not the previous poll (review 8)');
  assert.equal(src.indexOf('pjArchHead()'), -1, 'the header alone is never changed by the poll');
});

test('#7365 3b review 7: an answer that lands after the confirm left the screen, with no key pressed, is said rather than written into it', async () => {
  for (const ok of [true, false]) {
    let answer;
    const h = askPage({ answers: [count(0), () => new Promise((r) => { answer = r; }), count(260)] });
    h.ctx.ask();
    const press = h.el('pjarch-go').onclick();
    await new Promise((r) => setImmediate(r));
    h.el('pjarch-modal').getClientRects = () => [];   // hidden by something other than openProject, no keydown since
    const other = { id: 'elsewhere' }; h.doc.activeElement = other;
    answer(ok ? marked : { ok: false, json: async () => ({ ok: false }) });
    await press;
    assert.equal(h.el('pjarch-modal').hidden, true);
    assert.equal(h.el('pjarch-msg').textContent, 'Working…', 'nothing written into a confirm nobody can see');
    assert.equal(h.doc.activeElement, other, 'focus left where it was');
    assert.match(h.toasts.join('|'), ok ? /^In Alpha: / : /^We could not archive Alpha just now; nothing changed\.$/);
  }
});

test('#7365 3b review 8: a background re-read keeps the reader where they are (no scroll, focus or announcement), and a failed one keeps the view', async () => {
  const fresh = { rows: [{ kind: 'post', id: 'a1', text: 'archived one' }, { kind: 'post', id: 'a2', text: 'one more' }], olderCount: 0, archivedCount: 7, archiveMarker: { before: 'y' } };
  const h = archPage({ reads: [page1, fresh, null] });
  Object.assign(h.ctx.PJ_WIN, { pid: 'p1' });
  await h.ctx.pjArchOpen();
  const said = h.said.length;
  h.el('pj-room').scrollTop = 120;
  const elsewhere = { id: 'pj-post' }; h.doc.activeElement = elsewhere;
  h.restored.length = 0;
  await h.ctx.pjArchOpen(true);
  assert.match(h.el('pj-room').innerHTML, /one more/);
  assert.equal(h.el('pj-room').scrollTop, 120, 'not thrown to the bottom');
  assert.equal(h.doc.activeElement, elsewhere, 'focus not taken');
  assert.equal(h.said.length, said, 'nothing announced');
  assert.equal(h.restored.length, 1, "the archive's own place is restored");
  assert.equal(h.el('pj-arch-count').textContent, '7 messages');
  assert.equal(h.ctx.PJ_ARCH.readAs, '7|{"before":"y"}');
  await h.ctx.pjArchOpen(true);   // this read fails
  assert.equal(h.ctx.PJ_ARCH.on, true, 'the view stays open');
  assert.match(h.el('pj-room').innerHTML, /one more/);
  assert.equal(h.el('pj-room-older-text').textContent, 'We could not refresh the archive just now; what is shown may be behind.');
  assert.deepEqual(h.toasts, []);
  assert.equal(h.ctx.PJ_ARCH.readAs, '7|{"before":"y"}', 'still recorded under the last read, so the next poll tries again');
});

test('#7365 3b review 8: after Archive the live room drops only the leading run older than the cutoff, as the server splits', () => {
  const box = { __lastBody: { rows: [{ id: 'a', at: '2026-10-01T00:00:00.000Z' }, { id: 'b', at: '2026-10-25T00:00:00.000Z' }, { id: 'c', at: '2026-10-02T00:00:00.000Z' }] } };
  const ctx = vm.createContext({ Date, Number, Array, Object });
  vm.runInContext(liftConst(SCRIPT, 'PJ_WIN') + '\n' + liftAll(SCRIPT, ['pjRoomDropArchived']) + '\nthis.PJ_WIN = PJ_WIN; this.f = pjRoomDropArchived;', ctx);
  Object.assign(ctx.PJ_WIN, { older: [{ id: 'o1', at: '2026-09-01T00:00:00.000Z' }, { id: 'o2' }, { id: 'o3', at: '2026-09-02T00:00:00.000Z' }], newest: [{ id: 'n1', at: '2026-09-03T00:00:00.000Z' }] });
  ctx.f(box, '2026-10-20T00:00:00.000Z');
  assert.deepEqual(box.__lastBody.rows.map((r) => r.id), ['b', 'c'], 'c is older but after b, which is not: it stays live');
  assert.deepEqual(ctx.PJ_WIN.older.map((r) => r.id), ['o2', 'o3'], 'an undated row stops the run');
  assert.deepEqual(ctx.PJ_WIN.newest.map((r) => r.id), ['n1'], 'the held pages did not end the run, so the newest page keeps its rows');
});

test('#7365 3b browser runs 2-3: Back paints the room with no scroll state measured on the archive, so the anchor decides', async () => {
  for (const anchored of [true, false]) {
    const h = archPage({ reads: [page1] });
    Object.assign(h.ctx.PJ_WIN, { pid: 'p1' });
    await h.ctx.pjArchOpen();
    if (!anchored) h.ctx.PJ_ARCH.anchor = null;
    const box = h.el('pj-room');
    // What the archive's own paints left: rows, a pixel top, and "on the floor" (the archive opens at its bottom).
    Object.assign(box, { __roomHadRows: true, __roomHeldTop: 0, __roomHeldAtBottom: true });
    let seen = null;
    h.ctx.paintRoom = () => { seen = { had: box.__roomHadRows, top: box.__roomHeldTop, bottom: box.__roomHeldAtBottom }; };
    h.ctx.pjArchClose();
    assert.deepEqual(seen, { had: false, top: undefined, bottom: !anchored },
      anchored ? 'with a place to return to, nothing pins or restores a pixel top' : 'with none, the room lands on the newest post');
  }
});

test('#7365 3b (Mona Lisa, phone): the thread\'s first row carries Archive older messages, beside the archived line, never a second line', () => {
  const { pjRoomTopEdge } = page();
  const asks = (h) => (h.match(/data-arch-ask/g) || []).length;
  const lines = (h) => (h.match(/class="pj-arch-edge/g) || []).length;
  // Rows, nothing archived yet: one row, holding the link.
  const a = pjRoomTopEdge(false, true, false);
  assert.equal(lines(a), 1); assert.equal(asks(a), 1); assert.match(a, /pj-arch-top/);
  // At the start with messages archived: ONE line, the archived sentence, View archive and the link beside them.
  const b = pjRoomTopEdge(false, true, true);
  assert.equal(lines(b), 1, 'two competing lines at the top of the thread');
  assert.equal(asks(b), 1); assert.match(b, /Older messages are archived\./); assert.match(b, /id="pj-arch-open"/);
  assert.doesNotMatch(b, /pj-arch-top/, 'the archived line is shown on every screen, not only on a phone');
  // Searching, or an empty room: no link (nothing to archive, or the search covers both).
  assert.equal(asks(pjRoomTopEdge(true, true, true)), 0); assert.equal(pjRoomTopEdge(true, true, false), '');
  assert.equal(pjRoomTopEdge(false, false, false), '');
  // CONTROL: an empty room at its start with messages archived still says so, with View archive.
  assert.match(pjRoomTopEdge(false, false, true), /View archive/);
});

test('#7365 3b (phone): CSS hides the header link and shows the thread one only in the 30rem room query', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(html, /\.pj-arch-top, \.pj-arch-ask-top \{ display: none; \}/, 'shown on the desktop too');
  const i = html.indexOf('.pj-arch-top, .pj-arch-ask-top { display: none; }');
  const block = html.slice(i, html.indexOf('}', html.indexOf('@media (max-width: 30rem) {', i) + 400) + 400);
  assert.match(block, /@media \(max-width: 30rem\) \{[\s\S]*#pj-arch-ask \{ display: none; \}/, 'the header link stays on a phone');
  assert.match(block, /\.pj-arch-top \{ display: flex; \}/);
  assert.match(block, /\.linkish\.pj-arch-ctl\.pj-arch-ask-top \{[^}]*min-height: 44px/, 'not a 44 px target');
});

test('#7365 3b (phone review): focus goes to the Archive older messages on screen, else the composer, never a hidden one', () => {
  const ctx = vm.createContext({});
  const el = (id, shown) => ({ id, getClientRects: () => (shown ? [1] : []) });
  vm.runInContext(liftAll(SCRIPT, ['pjArchAskShown']) + '\nthis.f = pjArchAskShown;', ctx);
  const run = (headShown, threadEl) => {
    const head = el('pj-arch-ask', headShown), post = el('pj-post', true);
    ctx.document = { getElementById: (id) => (id === 'pj-arch-ask' ? head : id === 'pj-post' ? post : null), querySelector: () => threadEl };
    return ctx.f().id;
  };
  assert.equal(run(true, el('thread', false)), 'pj-arch-ask', 'desktop: the header link');
  assert.equal(run(false, el('thread', true)), 'thread', 'phone: the thread\'s link');
  assert.equal(run(false, null), 'pj-post', 'phone, no link shown (searching, empty room): the composer');
  assert.equal(run(false, el('thread', false)), 'pj-post', 'never a link that is not shown');
});
