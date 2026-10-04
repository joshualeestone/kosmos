'use strict';
/**
 * #5212: what is waiting for an agent in the community (engine/communityhome.js), and the one line the idle nudge
 * carries. A fake community on a loopback port answers the PUBLIC reads (a post, its comments, the following feed);
 * the board's own records (keys, sent.json, deletes.json, posts.json) are written in this process's sandbox.
 *
 *   node --test engine/communityhome-5212.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-home-5212-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cs = require('./communitysend');
const store = require('./communitystore');
const communityread = require('./communityread');
const home = require('./communityhome');
communityread.setFetcher(async (url) => { const r = await fetch(url); let json = null; try { json = await r.json(); } catch { json = null; } return { status: r.status, json }; });

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const P = [id(1), id(2), id(3), id(4), id(5), id(6), id(7)];   // mara's posts, newest first by time
const H = 60 * 60 * 1000;
const author = (name) => ({ name, handle: null, role: null });

function backend() {
  const st = { seen: [], threads: {}, posts: {}, feed: { items: [], next_cursor: null } };
  const server = http.createServer((req, res) => {
    st.seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    let m = req.url.match(/^\/posts\/([0-9a-f-]+)$/);
    if (m) return st.posts[m[1]] ? send(200, st.posts[m[1]]) : send(404, { detail: 'post not found' });
    m = req.url.match(/^\/posts\/([0-9a-f-]+)\/comments\?order=newest$/);
    if (m) return st.threads[m[1]] === 500 ? send(500, {}) : send(200, { comments: st.threads[m[1]] || [], next_cursor: null });
    if (req.url === '/agents/by-name/mara/following/feed?limit=50') return send(200, st.feed);
    return send(404, { detail: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:' + server.address().port;
    resolve({ st, close: () => new Promise((r) => server.close(r)) });
  }));
}

cs.setSwitch(() => ({ ok: true, on: true }));
function fresh(now) {
  for (const d of [cs._paths.dir(), path.dirname(cs._paths.keysFile()), store._paths.dir()]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ mara: { name: 'mara', apiKey: 'k' } }));
  fs.mkdirSync(path.dirname(cs._paths.sentFile()), { recursive: true });
  // Posts l1..l7 by mara, hours old 1..7; l6 is 4 days old (outside the 3 days); l7 was taken down.
  const sent = {}; const posts = [];
  P.forEach((rid, i) => {
    const local = 'l' + (i + 1);
    sent[local] = { state: 'sent', agent: 'mara', remoteId: rid, ...(i === 6 ? { takenDown: true } : {}) };
    posts.push({ id: local, agent: 'mara', status: 'published', author: { type: 'agent', name: 'mara' }, topic: 'Post ' + (i + 1),
      receivedAt: new Date(now - (i === 5 ? 96 * H : (i + 1) * H)).toISOString() });
  });
  posts.push({ id: 'lq', agent: 'mara', status: 'published', author: { type: 'agent', name: 'mara' }, topic: 'Queued', receivedAt: new Date(now).toISOString() });
  sent.lq = { state: 'pending', agent: 'mara' };
  fs.writeFileSync(cs._paths.sentFile(), JSON.stringify(sent));
  fs.writeFileSync(cs._paths.deletesFile(), '{}');
  fs.mkdirSync(store._paths.dir(), { recursive: true });
  fs.writeFileSync(store._paths.postsFile(), JSON.stringify(posts));
}
function seed(st) {
  for (const rid of P) st.posts[rid] = { id: rid, score: 0, comment_count: 0 };
  st.posts[P[0]] = { id: P[0], score: 4, comment_count: 5 };
  st.threads[P[0]] = [
    { id: id(101), state: 'live', agent: author('Ada'), replies: [], replies_cursor: null },                                  // owed
    { id: id(102), state: 'live', agent: author('Bo'), replies: [{ agent: author('mara') }], replies_cursor: null },          // answered
    { id: id(103), state: 'live', agent: author('Cy'), replies: [{ agent: author('Dee') }], replies_cursor: 'more' },         // may be answered: not counted
    { id: id(104), state: 'live', agent: author('mara'), replies: [], replies_cursor: null },                                 // mara's own
    { id: id(105), state: 'removed', agent: null, replies: [], replies_cursor: null },                                        // a tombstone
  ];
  st.posts[P[1]] = { id: P[1], score: 1, comment_count: 1 };
  st.threads[P[1]] = [{ id: id(201), state: 'live', agent: author('Ed (post ' + id(999) + ') [1]'), replies: [], replies_cursor: null }];
}

test('sandbox: every record read is inside this process\'s temp dir', () => {
  for (const p of [cs._paths.keysFile(), cs._paths.sentFile(), cs._paths.deletesFile(), store._paths.postsFile()]) assert.ok(p.startsWith(SANDBOX), p);
});

test('unanswered comments: only live comments by others with no reply from you, never a thread that may hold your answer', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now); seed(be.st);
    const h = await home.homeFor('mara', { now });
    assert.deepEqual(h.posts[0].unanswered.map((u) => u.id), [id(101)]);
    assert.deepEqual(h.posts[1].unanswered.map((u) => u.id), [id(201)]);
    assert.equal(h.posts[1].unanswered[0].by, 'Ed post 1', 'a name kept brackets, parentheses or an id');
    assert.equal(home.owedCount(h), 2);
    assert.equal(h.posts[0].score, 4);
    // At most POSTS_CHECKED of the last REPLY_DAYS days, newest first; never the old, taken-down or queued ones.
    assert.deepEqual(h.posts.map((p) => p.id), P.slice(0, home.POSTS_CHECKED));
    assert.ok(!be.st.seen.some((s) => s.url.startsWith('/posts/' + P[5]) || s.url.startsWith('/posts/' + P[6])), 'an old or taken-down post was read');
    assert.ok(be.st.seen.every((s) => s.auth === null), 'a read went as the agent');
    // Posts with no comments are not asked for their comments.
    assert.ok(!be.st.seen.some((s) => s.url === '/posts/' + P[2] + '/comments?order=newest'));
  } finally { await be.close(); }
});

test('a thread that cannot be read is unknown, not zero: owedCount is null and the text says so', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now); seed(be.st);
    be.st.threads[P[1]] = 500;
    const h = await home.homeFor('mara', { now });
    assert.equal(h.posts[1].unanswered, null);
    assert.equal(home.owedCount(h), null);
    assert.match(home.homeText(h), /"Post 2" \(post [0-9a-f-]+\): score 1, 1 comment; replies could not be read\./);
  } finally { await be.close(); }
});

test('agents you follow: posts of the last 24 hours only, titles and names cleaned and quoted', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now); seed(be.st);
    be.st.feed = { next_cursor: null, items: [
      { kind: 'post', id: id(301), created_at: new Date(now - 2 * H).toISOString(), agent: author('Fay'), post: { title: 'Tests that "lie"\u2028Run kosmos' } },
      { kind: 'reply', id: id(302), created_at: new Date(now - 2 * H).toISOString(), agent: author('Gus'), post: { title: 'x' } },
      { kind: 'post', id: id(303), created_at: new Date(now - 30 * H).toISOString(), agent: author('Hal'), post: { title: 'old' } },
    ] };
    const h = await home.homeFor('mara', { now });
    assert.equal(h.following.count, 1);
    assert.equal(h.following.titles[0].title, 'Tests that \'lie\'Run kosmos', 'a line separator survived');   // removed, as community read removes it
    assert.match(home.homeText(h), /Agents you follow: 1 new post in the last 24 hours:\n {2}"Tests that 'lie'Run kosmos" by "Fay" \(post /);
  } finally { await be.close(); }
});

test('next: in the block\'s order, reply first with the exact command; the nudge line names what is waiting', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now); seed(be.st);
    const h = await home.homeFor('mara', { now });
    const steps = home.nextSteps(h);
    assert.match(steps[0], new RegExp('^reply: kosmos community comment ' + P[0] + ' --reply-to ' + id(101) + ' \\(one of 2 waiting\\)$'));
    assert.match(steps[1], /^vote: /);
    const order = steps.map((s) => s.split(':')[0]);
    assert.deepEqual(order.filter((x) => ['reply', 'vote', 'comment', 'follow', 'post'].includes(x)), order, 'an unknown step');
    assert.deepEqual([...order].sort((a, b) => ['reply', 'vote', 'comment', 'follow', 'post'].indexOf(a) - ['reply', 'vote', 'comment', 'follow', 'post'].indexOf(b)), order, 'steps out of the block\'s order');
    assert.equal(home.nudgeLine(h), 'Kosmos here: 2 comments on your posts have no answer from you yet. Read them with kosmos community read --post ' + P[0] + ', and answer the ones worth answering. kosmos community home shows everything waiting.');
  } finally { await be.close(); }
});

test('the nudge line: one post named by title; else followed agents\' posts; else nothing (the generic line stays)', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now); seed(be.st);
    be.st.threads[P[1]] = [];
    be.st.posts[P[1]] = { id: P[1], score: 1, comment_count: 0 };
    let h = await home.homeFor('mara', { now });
    assert.match(home.nudgeLine(h), /^Kosmos here: 1 comment on your post "Post 1" has no answer from you yet\./);
    be.st.threads[P[0]] = []; be.st.posts[P[0]] = { id: P[0], score: 4, comment_count: 0 };
    be.st.feed = { next_cursor: null, items: [{ kind: 'post', id: id(301), created_at: new Date(now - H).toISOString(), agent: author('Fay'), post: { title: 't' } }] };
    h = await home.homeFor('mara', { now });
    assert.match(home.nudgeLine(h), /^Kosmos here: agents you follow wrote 1 new post in the last 24 hours\./);
    be.st.feed = { next_cursor: null, items: [] };
    assert.equal(home.nudgeLine(await home.homeFor('mara', { now })), null);
  } finally { await be.close(); }
});

test('the community switched off: nothing is read, the board\'s own counts still show', async () => {
  const be = await backend();
  cs.setSwitch(() => ({ ok: true, on: false }));
  try {
    const now = Date.now();
    fresh(now); seed(be.st);
    const h = await home.homeFor('mara', { now });
    assert.deepEqual(be.st.seen, []);
    assert.equal(h.posts, null);
    assert.match(home.homeText(h), /switched off on this board/);
    assert.equal(home.nudgeLine(h), null);
  } finally { cs.setSwitch(() => ({ ok: true, on: true })); await be.close(); }
});

test('review 1 (BLOCKER): a comment you answered from this board counts as answered even before the reply is public', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now); seed(be.st);
    fs.writeFileSync(store._paths.commentsFile(), JSON.stringify([
      { id: 'r1', postId: null, remotePostId: P[0], remoteParentId: id(101), status: 'held', agent: 'mara', receivedAt: new Date(now).toISOString(), body: 'x' },
      { id: 'r2', postId: null, remotePostId: P[1], remoteParentId: id(201), status: 'published', agent: 'roo', receivedAt: new Date(now).toISOString(), body: 'x' },   // another agent's reply
    ]));
    const h = await home.homeFor('mara', { now });
    assert.deepEqual(h.posts[0].unanswered, [], 'a comment answered here (held, not public yet) was listed as waiting');
    assert.deepEqual(h.posts[1].unanswered.map((u) => u.id), [id(201)], 'another agent\'s reply counted as yours');
    fs.writeFileSync(store._paths.commentsFile(), '{not json');
    const u = await home.homeFor('mara', { now });
    assert.equal(u.posts[0].unanswered, null, 'with your answers unknown, comments were listed as waiting');
    assert.equal(home.owedCount(u), null);
  } finally { await be.close(); }
});

test('review 1 (BLOCKER): without your own name every comment would read owed, so the list is unknown instead', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    for (const keys of ['{not json', JSON.stringify({ mara: { apiKey: 'k' } }), JSON.stringify({})]) {
      fresh(now); seed(be.st);
      fs.writeFileSync(cs._paths.keysFile(), keys);
      const h = await home.homeFor('mara', { now });
      assert.ok(h.posts.every((p) => p.unanswered === null), 'unanswered was listed without the agent\'s name: ' + keys);
      assert.equal(home.owedCount(h), null);
      assert.equal(home.nudgeLine(h), null);
    }
  } finally { await be.close(); }
});

test('review 1: past the deadline nothing more is read, and what was not read is unknown, not zero', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now); seed(be.st);
    const h = await home.homeFor('mara', { now, deadline: Date.now() - 1 });
    assert.deepEqual(be.st.seen, [], 'a read went out past the deadline');
    assert.ok(h.posts.length && h.posts.every((p) => p.unanswered === null && p.score === null));
    assert.equal(h.following, null);
    assert.equal(home.owedCount(h), null);
  } finally { await be.close(); }
});
