'use strict';
/**
 * #5211 item 2: the line after an agent votes or comments (engine/communitynudge.js): who wrote the post, whether the
 * agent follows them, and its counts for the last 24 hours against the floors. A fake community on a loopback port
 * answers login, GET /agents/me/votes, the public post read and the public following list; the board's own records
 * (comments, posts, new follows) are written in this process's sandbox.
 *
 *   node --test engine/communitynudge-5211.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-nudge-5211-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cs = require('./communitysend');
const store = require('./communitystore');
const nudge = require('./communitynudge');
const FLOORS = (() => { try { return require('./communityblock').FLOORS || null; } catch { return null; } })();

const POST = '11111111-2222-4333-8444-555555555555';
const OWN = '22222222-2222-4333-8444-555555555555';
const H = 60 * 60 * 1000;

function backend() {
  const st = { seen: [], following: { agents: [{ name: 'Someone' }], next_cursor: null }, votes: { last_24h: 2, required: 3, remaining_required: 1, cast_last_24h: 2, limit: 50 }, postStatus: 200 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/login') return body && body.api_key === 'kmara' ? send(200, { token: 'tokmara' }) : send(401, { detail: 'no' });
      const pub = req.method === 'GET' && req.url.match(/^\/posts\/([0-9a-f-]+)$/);
      if (pub) {
        if (st.postStatus !== 200) return send(st.postStatus, { detail: 'x' });
        if (pub[1] === POST) return send(200, { id: POST, title: 't', agent: { name: 'Ada‮\u0007 Lovelace', handle: 'ada-3f2c' } });
        if (pub[1] === OWN) return send(200, { id: OWN, title: 't', agent: { name: 'mara', handle: 'mara-1' } });
        return send(404, { detail: 'post not found' });
      }
      if (req.method === 'GET' && /^\/agents\/by-name\/mara\/following\?limit=100$/.test(req.url)) return send(200, st.following);
      if ((req.headers.authorization || '') !== 'Bearer tokmara') return send(401, { detail: 'invalid or expired token' });
      if (req.method === 'GET' && req.url === '/agents/me/votes') return send(200, st.votes);
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:' + server.address().port;
    resolve({ st, close: () => new Promise((r) => server.close(r)) });
  }));
}

cs.setSwitch(() => ({ ok: true, on: true }));
cs.setSender((url, init) => fetch(url, init));
function fresh(now) {
  fs.rmSync(cs._paths.dir(), { recursive: true, force: true });
  fs.rmSync(path.dirname(cs._paths.keysFile()), { recursive: true, force: true });
  fs.rmSync(store._paths.dir(), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ mara: { name: 'mara', apiKey: 'kmara' } }));
  cs.setTimeoutMs(5000); cs.setAgentWaitMs(null); cs.setAgentBudgetMs(null);
  // The board's own records: two comments by mara (one 30 h old), one by another agent; two posts (one old).
  fs.mkdirSync(store._paths.dir(), { recursive: true });
  const iso = (ms) => new Date(now - ms).toISOString();
  fs.writeFileSync(store._paths.commentsFile(), JSON.stringify([
    { id: 'c1', postId: null, remotePostId: POST, status: 'published', agent: 'mara', receivedAt: iso(1 * H), body: 'x' },
    { id: 'c2', postId: null, remotePostId: POST, status: 'published', agent: 'mara', receivedAt: iso(30 * H), body: 'x' },
    { id: 'c3', postId: null, remotePostId: POST, status: 'published', agent: 'ben', receivedAt: iso(1 * H), body: 'x' },
  ]));
  fs.writeFileSync(store._paths.postsFile(), JSON.stringify([
    { id: 'p1', agent: 'mara', author: { type: 'agent', name: 'mara' }, receivedAt: iso(2 * H) },
    { id: 'p2', agent: 'mara', author: { type: 'agent', name: 'mara' }, receivedAt: iso(40 * H) },
  ]));
}
// What the floors part must read, from the block's own numbers when they exist (one source: communityblock.FLOORS).
function today(votes, comments, follows, posts) {
  const f = FLOORS;
  return 'Today: votes ' + votes + ', comments ' + comments + (f ? '/' + f.commentsPerDay : '')
    + ', follows ' + follows + (f ? (f.followsEveryDays === 1 ? '/1' : ' (1 new every ' + f.followsEveryDays + ' days)') : '')
    + ', posts ' + posts + (f ? ' (min ' + f.postsPerDayMin + ', max ' + f.postsPerDayMax + ')' : '') + '.';
}

test('sandbox: every file the nudge reads or writes is inside this process\'s temp dir', () => {
  for (const p of [nudge.followsFile(), store._paths.commentsFile(), store._paths.postsFile(), cs._paths.keysFile()]) assert.ok(p.startsWith(SANDBOX), p);
});

test('after a vote on a post: the author (name and handle), that you do not follow them, and the last 24 hours against the floors', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now);
    nudge.noteFollowed('mara', 'Lin', now - 2 * H);
    nudge.noteFollowed('mara', 'lin', now - 1 * H);   // the same agent twice counts once
    nudge.noteFollowed('mara', 'Old', now - 30 * H);  // outside the 24 hours
    nudge.noteFollowed('ben', 'Kit', now - 1 * H);    // another agent's follow
    const line = await nudge.nudge('mara', { postId: POST, now });
    // The author's name loses its control and direction characters (it is another agent's text).
    assert.equal(line, 'That post is by Ada Lovelace (@ada-3f2c); you do not follow them. ' + today('2/3', 1, 1, 1));
    assert.ok(be.st.seen.some((s) => s.url === '/posts/' + POST && s.auth === null), 'the post was read publicly');
    assert.ok(be.st.seen.some((s) => s.url === '/agents/me/votes' && s.auth === 'Bearer tokmara'), 'votes were read as the agent');
  } finally { await be.close(); }
});

test('"you follow them" when the author is in the first page of your following list; nothing said when the list has more pages and they are not in it', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now);
    be.st.following = { agents: [{ name: 'ada‮\u0007 lovelace' }], next_cursor: null };
    assert.match(await nudge.nudge('mara', { postId: POST, now }), /^That post is by Ada Lovelace \(@ada-3f2c\); you follow them\. Today:/);
    be.st.following = { agents: [{ name: 'Someone' }], next_cursor: 'more' };
    assert.match(await nudge.nudge('mara', { postId: POST, now }), /^That post is by Ada Lovelace \(@ada-3f2c\)\. Today:/, 'a "no" from a partial list was said');
  } finally { await be.close(); }
});

test('a comment on your own post says so; a comment vote (no post) gives only the counts', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now);
    assert.match(await nudge.nudge('mara', { postId: OWN, now }), /^That post is yours\. Today: votes 2\/3,/);
    assert.equal(await nudge.nudge('mara', { now }), today('2/3', 1, 0, 1));
    assert.ok(!be.st.seen.some((s) => /^\/posts\//.test(s.url) && s.url !== '/posts/' + OWN), 'a post was read for a comment vote');
  } finally { await be.close(); }
});

test('what cannot be read is left out, never guessed: an unreadable post, a failed votes read, an unreadable record', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now);
    be.st.postStatus = 500;
    be.st.votes = { last_24h: 'x' };
    assert.equal(await nudge.nudge('mara', { postId: POST, now }), today('', 1, 0, 1).replace('votes , ', ''), 'an unreadable part was printed');
    fs.writeFileSync(store._paths.commentsFile(), '{not json');
    const line = await nudge.nudge('mara', { postId: POST, now });
    assert.ok(!/comments/.test(line), 'an unreadable comments record read as a count: ' + line);
    // A read-only line never moves the record aside (communitystore's loadJson quarantines an unreadable file).
    assert.equal(fs.readFileSync(store._paths.commentsFile(), 'utf8'), '{not json', 'the comments record was rewritten');
    assert.deepEqual(fs.readdirSync(store._paths.dir()).filter((f) => f.includes('corrupt')), [], 'the comments record was quarantined');
  } finally { await be.close(); }
});

test('the community switched off, or the service unreachable: the board\'s own counts still show, and nothing throws', async () => {
  const now = Date.now();
  fresh(now);
  cs.setSwitch(() => ({ ok: true, on: false }));
  try {
    assert.equal(await nudge.nudge('mara', { postId: POST, now }), today('', 1, 0, 1).replace('votes , ', ''));
  } finally { cs.setSwitch(() => ({ ok: true, on: true })); }
  cs.setSender(() => Promise.reject(new Error('down')));
  try {
    const line = await nudge.nudge('mara', { postId: POST, now });
    assert.ok(typeof line === 'string' && /^Today: comments 1/.test(line), String(line));
  } finally { cs.setSender((url, init) => fetch(url, init)); }
});

test('noteFollowed keeps two days and drops older lines when it next writes; a torn line is skipped', () => {
  const now = Date.now();
  fresh(now);
  nudge.noteFollowed('mara', 'A', now - 50 * H);
  nudge.noteFollowed('mara', 'B', now - 1 * H);
  fs.appendFileSync(nudge.followsFile(), '{"agent":"mara","na');
  nudge.noteFollowed('mara', 'C', now);
  const lines = fs.readFileSync(nudge.followsFile(), 'utf8').trim().split('\n').map((l) => JSON.parse(l).name);
  assert.deepEqual(lines, ['B', 'C']);
  assert.equal(nudge.localCounts('mara', now).follows, 2);
  assert.equal((fs.statSync(nudge.followsFile()).mode & 0o777).toString(8), '600');
});
