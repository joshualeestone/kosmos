'use strict';
/**
 * kosmos#7365: a project room draws its newest page (PJ_WIN_PAGE rows) and the earlier pages the reader scrolls back
 * to, instead of fetching and rebuilding the whole room every 5 s (a 5,500-post room froze the page for about 2 s of
 * every poll). The page's own loadRoom, pjWinEarlier, pjWinRead, pjWinMerge and pjWinReset run here against a fake room
 * that pages exactly as GET /api/project/:id/room?n=&cursor= does (#7032: the last n rows before the cursor, each row
 * carrying its `key`, plus olderCount and olderCursor).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scriptOf, liftAll, liftConst } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const SRC = [
  liftConst(SCRIPT, 'PJ_WIN_PAGE'),
  liftConst(SCRIPT, 'PJ_WIN'),
  liftConst(SCRIPT, 'THREAD_BOTTOM_SLACK'),
  liftAll(SCRIPT, ['pjWinReset', 'pjWinOlderLine', 'pjWinMerge', 'pjWinNoteReactions', 'pjWinRead', 'pjWinEarlier', 'loadRoom']),
].join('\n');

/* A room of `n` posts, one second apart (so every key is "<at>|0"), paged as the server pages it. */
function fakeRoom(n) {
  const rows = [];
  const add = (k) => { const at = new Date(Date.UTC(2024, 0, 1) + rows.length * 1000).toISOString(); rows.push({ kind: 'post', id: 'p' + (rows.length + 1), text: 'post ' + (rows.length + 1), at }); };
  for (let i = 0; i < n; i++) add();
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url, 'http://board.invalid');
    const nq = u.searchParams.get('n');
    const keyed = rows.map((r) => ({ ...r, key: r.at + '|0' }));
    if (nq === null) return { ok: true, json: async () => ({ ok: true, rows: rows.map((r) => ({ ...r })), unanswered: {} }) };
    let pool = keyed;
    const cursor = u.searchParams.get('cursor');
    if (cursor) {
      const at = keyed.findIndex((r) => r.key === cursor);
      if (at < 0) return { ok: false, json: async () => ({ error: 'no such place' }) };
      pool = keyed.slice(0, at);
    }
    const page = pool.slice(-Number(nq));
    const olderCount = pool.length - page.length;
    return { ok: true, json: async () => ({ ok: true, rows: page, unanswered: {}, olderCount, olderCursor: olderCount > 0 ? page[0].key : null }) };
  };
  return { rows, add, calls, fetch };
}

function harness(room, project = 'proj') {
  // On the floor unless a test scrolls it up (the live position loadRoom measures before anchoring a gap).
  const box = { __lastBody: undefined, clientHeight: 500, scrollHeight: 10000, scrollTop: 9500 };
  const msg = { textContent: '' };
  const painted = [];
  const anchors = { taken: 0, restored: 0 };
  const ctx = {
    console, URL, Number, String, Array, Object, Set, Map, JSON, encodeURIComponent, Error,
    fetch: (u) => room.fetch(u),
    document: { getElementById: (id) => (id === 'pj-room' ? box : id === 'pj-room-msg' ? msg : null) },
    pjById: (id) => ({ id }),
    paintRoom: (body) => { painted.push(body); box.__lastBody = body; },
    threadAnchor: () => { anchors.taken += 1; return { mid: 'x' }; },
    restoreThreadAnchor: () => { anchors.restored += 1; return true; },
    convPause: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext('var PJ_CURRENT = ' + JSON.stringify(project) + '; var PJ_ROOM_GEN = 0; var PJ_ROOM_QUERY = "";\n' + SRC
    + '\nthis.api = { loadRoom, pjWinEarlier, pjWinMerge, pjWinReset, pjWinNoteReactions, PJ_WIN, set query(q) { PJ_ROOM_QUERY = q; }, set current(p) { PJ_CURRENT = p; } };', ctx);
  return { api: ctx.api, box, painted, anchors };
}
const ids = (body) => JSON.parse(JSON.stringify(body.rows.map((r) => r.id)));   // out of the vm realm
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => 'p' + (a + i));

test('#7365: a poll reads only the newest page, and paints it', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();
  assert.match(room.calls[0], /\/room\?n=200$/, 'the poll asks for the newest page, not the whole room');
  assert.deepEqual(ids(h.painted.at(-1)), range(801, 1000));
  assert.equal(h.api.PJ_WIN.olderCount, 800);
});

test('#7365: scrolling back reads each earlier page by cursor, anchors the reader, and reaches the first post with nothing twice', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();
  for (let k = 0; k < 10 && h.api.PJ_WIN.olderCount > 0; k++) await h.api.pjWinEarlier();
  const last = h.painted.at(-1);
  assert.deepEqual(ids(last), range(1, 1000), 'every post, in order, once');
  assert.ok(room.calls.slice(1).every((u) => /\?n=200&cursor=/.test(u)), 'earlier pages are read by cursor');
  assert.equal(h.anchors.taken, 4, 'one anchor per earlier page');
  assert.equal(h.anchors.restored, 4);
  const before = room.calls.length;
  await h.api.pjWinEarlier();
  assert.equal(room.calls.length, before, 'at the first post, reaching the top asks for nothing more');
});

test('#7365: a poll after scrolling back keeps the earlier pages, and reads a gap of new rows so nothing falls between', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();
  await h.api.pjWinEarlier();   // posts 601 to 1000 held
  h.box.scrollTop = 1000;   // the reader is scrolled up, reading
  for (let i = 0; i < 50; i++) room.add();   // 50 new posts: the newest page now starts at 851, a gap of 801 to 850
  await h.api.loadRoom();
  assert.deepEqual(ids(h.painted.at(-1)), range(601, 1050), 'the earlier pages, the gap and the newest page, contiguous');
  assert.ok(room.calls.some((u) => /\?n=50&cursor=/.test(u)), 'the gap is read by the newest page\'s cursor');
  assert.equal(h.anchors.restored, 2, 'the scrolled-up reader is anchored when the gap lands above them');
  // CONTROL: with no new rows, a poll reads one page and adds nothing.
  const n = room.calls.length;
  await h.api.loadRoom();
  assert.equal(room.calls.length, n + 1);
  assert.deepEqual(ids(h.painted.at(-1)), range(601, 1050));
});

test('#7365: more new rows than a page between polls drops the earlier pages rather than leave a hole', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();
  await h.api.pjWinEarlier();
  for (let i = 0; i < 450; i++) room.add();
  await h.api.loadRoom();
  assert.deepEqual(ids(h.painted.at(-1)), range(1251, 1450), 'only the newest page: no rows missing between pages');
  assert.equal(h.api.PJ_WIN.older.length, 0);
});

test('#7365: a search reads the whole room, so it finds every message; another project starts the window again', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();
  await h.api.pjWinEarlier();
  h.api.query = 'post 7';
  await h.api.loadRoom();
  assert.match(room.calls.at(-1), /\/room$/, 'a search reads the room whole');
  assert.equal(h.painted.at(-1).rows.length, 1000);
  const n = room.calls.length;
  await h.api.pjWinEarlier();
  assert.equal(room.calls.length, n, 'no earlier page is read while searching');
  h.api.query = '';
  h.api.current = 'other';
  await h.api.loadRoom();
  assert.equal(h.api.PJ_WIN.pid, 'other');
  assert.equal(h.api.PJ_WIN.older.length, 0, 'the last project\'s earlier pages are not carried over');
  assert.deepEqual(ids(h.painted.at(-1)), range(801, 1000));
});

test('#7365: pjWinMerge keeps a row on both reads once, from the newer read, in order', () => {
  const { api } = harness(fakeRoom(1));
  const merged = api.pjWinMerge([{ key: 'a', v: 1 }, { key: 'b', v: 1 }], [{ key: 'b', v: 2 }, { key: 'c', v: 2 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(merged)), [{ key: 'a', v: 1 }, { key: 'b', v: 2 }, { key: 'c', v: 2 }]);
});

test('#7365 review 1: a poll landing while the first earlier page is in flight loses no row', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();   // newest 801 to 1000
  let release; const gate = new Promise((r) => { release = r; });
  const real = room.fetch;
  room.fetch = async (u) => { if (/cursor=/.test(u)) { const resp = await real(u); await gate; return resp; } return real(u); };
  const earlier = h.api.pjWinEarlier();   // asks for 601 to 800, held back
  for (let i = 0; i < 30; i++) room.add();   // 30 new posts: the newest page is now 831 to 1030
  await h.api.loadRoom();   // the poll answers first
  release(); await earlier;
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));   // the read pjWinEarlier starts when the page moved
  assert.deepEqual(ids(h.painted.at(-1)), range(601, 1030), 'every row from the first earlier page to the newest, none lost');
});

test('#7365 review 1: a failed earlier read is said once and not asked again until Try again', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();
  const real = room.fetch;
  room.fetch = async (u) => (/cursor=/.test(u) ? { ok: false, json: async () => ({ error: 'down' }) } : real(u));
  await h.api.pjWinEarlier();
  assert.equal(h.api.PJ_WIN.because, 'We could not read the earlier messages.');
  const n = room.calls.length;
  for (let i = 0; i < 5; i++) await h.api.pjWinEarlier();   // the reader keeps scrolling at the top
  assert.equal(room.calls.length, n, 'no request until the person asks again');
  room.fetch = real;
  h.api.PJ_WIN.because = null;   // what Try again does
  await h.api.pjWinEarlier();
  assert.deepEqual(ids(h.painted.at(-1)), range(601, 1000), 'Try again reads the page');
});

test('#7365 review 1: a reader on the floor NOW is not anchored when a gap lands (the paint keeps them on the newest row)', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();
  await h.api.pjWinEarlier();
  const restoredBefore = h.anchors.restored;
  for (let i = 0; i < 50; i++) room.add();
  await h.api.loadRoom();   // the box is on the floor (its default)
  assert.equal(h.anchors.restored, restoredBefore, 'no anchor pulls a floor reader off the newest row');
  assert.deepEqual(ids(h.painted.at(-1)), range(601, 1050));
});

test('#7365 review 1: a reaction made here on an earlier page\'s post is kept in the held row', async () => {
  const room = fakeRoom(1000);
  const h = harness(room);
  await h.api.loadRoom();
  await h.api.pjWinEarlier();   // 601 to 800 held
  h.api.pjWinNoteReactions('proj', 'p700', [{ emoji: '👍', count: 1, who: ['you'], mine: true }], null);
  await h.api.loadRoom();   // the next poll rebuilds from the held rows
  const row = h.painted.at(-1).rows.find((r) => r.id === 'p700');
  assert.equal(row.reactions[0].emoji, '👍');
  h.api.pjWinNoteReactions('other-project', 'p701', [{ emoji: '🔥', count: 1, who: ['you'], mine: true }], null);
  assert.equal('reactions' in h.api.PJ_WIN.older.find((r) => r.id === 'p701'), false, 'another project\'s answer touches nothing');
});
