'use strict';
/**
 * kosmos#4373 part B: an agent's comment on a post in the PUBLIC community service.
 * The board takes the service's post id (the one `kosmos community read` prints), passes the
 * comment through the same choke as a post (since #4781 a clean one publishes straight away; a leak is
 * quarantined), and the send layer delivers it once published: POST /posts/{id}/comments { body } as the registered agent, at most once.
 * A fake kosmos-community on a loopback port answers with the #4370 contract (v0.2.0).
 * Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communitycomment-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');

const POST = crypto.randomUUID();          // a post on the service, as read would show it

// A fake kosmos-community with the #4370 comment route. `mode` bends one answer per test.
function backend() {
  const st = { agents: new Map(), comments: [], seen: [], mode: {}, n: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null });
      const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'kc_key_' + id, token: 'tok_' + id, active: true };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      if (req.method === 'POST' && req.url === '/agents/login') {
        const a = [...st.agents.values()].find((x) => x.name === body.name && x.key === body.api_key);
        if (!a) return send(401, { detail: 'wrong name or key' });
        a.token = 'tok_' + a.id + '_' + (++st.n);
        return send(200, { token: a.token });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      const a = [...st.agents.values()].find((x) => x.token === t && x.active);
      // #4939 review 3: posts too, for the post pass's in-flight test below.
      if (req.method === 'POST' && req.url === '/posts') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        st.posts = st.posts || [];
        const id = crypto.randomUUID();
        st.posts.push({ id, agent: a.id, title: body.title, body: body.body });
        return send(201, { id });
      }
      const m = /^\/posts\/([^/]+)\/comments$/.exec(req.url);
      if (req.method === 'POST' && m) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const extra = Object.keys(body).filter((k) => !['body', 'parent_id'].includes(k));
        if (extra.length) return send(422, { detail: [{ type: 'extra_forbidden', loc: ['body', extra[0]] }] });
        if (st.mode.status) return send(st.mode.status, st.mode.json || { detail: 'no' }, st.mode.headers || {});
        if (st.mode.hangup) { req.socket.destroy(); return undefined; }
        if (decodeURIComponent(m[1]) !== POST) return send(404, { detail: 'post not found' });
        const id = crypto.randomUUID();
        st.comments.push({ id, post: m[1], agent: a.id, body: body.body });
        return send(201, { id, parent_id: null, body: body.body, state: 'live' });
      }
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = `http://127.0.0.1:${server.address().port}/`;
    resolve({ st, server });
  }));
}

let be;
let SW = { on: false, ok: true };
async function on() { SW = { on: true, ok: true }; await cs.sweep(); }
function fresh() {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  SW = { on: false, ok: true };
  cs.setSwitch(() => SW);
  fs.rmSync(data, { recursive: true, force: true });
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
}
test.beforeEach(async () => { fresh(); be = await backend(); });
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });

function comment(agent, text, { trusted = true, post = POST } = {}) {
  if (trusted) communitystore.grantTrust(agent);
  // #3485 auto-publish (2026-09-30): an agentId now publishes straight away, so a HELD fixture asks the choke for the
  // hold explicitly (trusted: false), standing for a row held before that update (the same change #4781 made for posts).
  return feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: post }, trusted ? { agentId: agent } : { trusted: false });
}
const sends = () => be.st.seen.filter((s) => s.method === 'POST' && /\/comments$/.test(s.url));

test('the state files land under the sandboxed data root', () => {
  assert.ok(cs._paths.commentsSentFile().startsWith(SANDBOX));
  assert.ok(communitystore._paths.commentsFile().startsWith(SANDBOX));
});

test('the board refuses what the service must refuse, before anything is stored', () => {
  for (const [post, why] of [['', /id of a community post/], ['not-a-uuid', /id of a community post/], ['../posts/x', /id of a community post/]]) {
    const r = comment('ava', 'hello', { post });
    assert.equal(r.ok, false, post); assert.match(r.error, why);
  }
  const blank = comment('ava', '   ');
  assert.equal(blank.ok, false);
  // The service counts characters, not UTF-16 units: 2000 emoji pass, 2001 characters do not.
  assert.equal(comment('ava', '\u{1F600}'.repeat(2000)).ok, true, '2000 characters is the service limit, not over it');
  const long = comment('ava', 'x'.repeat(2001));
  assert.equal(long.ok, false); assert.match(long.error, /at most 2000 characters/);
  assert.equal(communitystore.moderationQueue().length, 0, 'a refused comment left a row to moderate');
});

test('an explicit hold (trusted: false): the comment is held and never sent; released, it is', async () => {
  await on();
  const r = comment('bo', 'a clean comment from a new agent', { trusted: false });
  assert.equal(r.ok, true); assert.equal(r.status, 'held');
  await cs.sweep();
  assert.equal(sends().length, 0, 'a held comment reached the service');
  const row = communitystore.moderationQueue().find((x) => x.id === r.id);
  assert.ok(row, 'the held comment is not in the moderation queue');
  assert.equal(row.postId, null); assert.equal(row.remotePostId, POST);
  communitystore.releaseHeld(r.id);
  await cs.sweep();
  assert.equal(sends().length, 1, 'the released comment was not sent');
  assert.deepEqual(sends()[0].body, { body: 'a clean comment from a new agent' }, 'only the body may reach the service');
  assert.equal(sends()[0].url, '/posts/' + POST + '/comments');
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
});

test('a leak is quarantined, never sent, and reads as held to the agent', async () => {
  await on();
  const r = comment('ava', 'mail me at ava@example.com');
  assert.equal(r.status, 'quarantined');
  await cs.sweep();
  assert.equal(sends().length, 0);
});

test('a comment on a service post is never served on the board\'s own site, even if a local post had the same id', () => {
  // Review 3: a local post is given the SERVICE post's id, so a row carrying that id as its postId would be served.
  communitystore.grantTrust('ava');   // so the local post is published (the control below needs it in the feed)
  const local = feedpublish.publishPost({ kind: 'community_post', agent: 'ava', at: 'x', topic: 't', body: 'local post' }, { agentId: 'ava' });
  const postsFile = communitystore._paths.postsFile();
  const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
  posts.find((p) => p.id === local.id).id = POST;
  fs.writeFileSync(postsFile, JSON.stringify(posts));
  const r = comment('ava', 'hello there');
  assert.equal(r.status, 'published');
  assert.deepEqual(communitystore.getComments(POST), [], 'a service comment was served on the board\'s own site');
  const feedRow = communitystore.publicFeed().find((p) => p.id === POST);
  assert.ok(feedRow, 'control: the local post with that id is in the feed');
  assert.equal(feedRow.commentCount || 0, 0, 'a service comment was counted on a local post');
});

test('review (merge): an agent the service will not register yet leaves a visible pending record, and the next sweep sends it', async () => {
  await on();
  const r = comment('ava', 'Tuesdays work for us too.');
  cs.setSender(async (url, init) => (String(url).endsWith('/agents/register')
    ? { status: 500, ok: false, headers: new Headers(), text: async () => '{}', json: async () => ({}) }
    : fetch(url, init)));
  await cs.sweep();
  assert.equal(sends().length, 0, 'CONTROL: nothing was sent while it could not register');
  const st = cs.commentStatuses()[r.id];
  assert.ok(st, 'the comment has no record, so nothing says why it has not gone');
  assert.equal(st.state, 'pending', JSON.stringify(st));
  assert.deepEqual(st.reasons, ['not_registered']);
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  assert.equal(sends().length, 1, 'a not_registered comment was not tried again');
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
});

test('review (merge): turning Community off ends the ON period at once, so a comment released after it never goes', async () => {
  await on();
  const stateFile = cs._paths.stateFile();
  assert.equal(typeof JSON.parse(fs.readFileSync(stateFile, 'utf8')).since, 'string', 'CONTROL: the ON period started');
  SW = { on: false, ok: true };
  cs.endOnPeriodNow();
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).since, undefined, 'OFF left the old window open');
  const r = comment('ava', 'Released while off.');
  // The window is `receivedAt >= since` in milliseconds. Without a gap the next ON period can start in the SAME
  // millisecond the comment was made, and then the comment is inside it: the test flaked 2 runs in 3 alone. A real
  // OFF-then-ON has a person's gap between the two; this is the smallest one (as review 1's test does).
  await new Promise((res) => setTimeout(res, 5));
  SW = { on: true, ok: true };        // back ON before any sweep ran while OFF
  await cs.sweep();
  assert.equal(sends().filter((x) => x.body && x.body.body === 'Released while off.').length, 0, 'a comment made while OFF went out');
  assert.ok(r.id);
});

test('a published comment is sent once, as the registered agent, and a second sweep sends nothing', async () => {
  await on();
  const r = comment('ava', 'Tuesdays work for us too.');
  await cs.sweep();
  await cs.sweep();
  assert.equal(sends().length, 1);
  const agent = [...be.st.agents.values()][0];
  assert.equal(sends()[0].auth, 'Bearer ' + agent.token);
  assert.equal(be.st.comments.length, 1);
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
});

test('nothing is sent while the switch is off, or for a comment made before it came on', async () => {
  comment('ava', 'made while off');
  await cs.sweep();
  assert.equal(sends().length, 0, 'sent with the switch off');
  await new Promise((res) => setTimeout(res, 5));   // not in the millisecond the ON period starts (the window is >=)
  await on();
  await cs.sweep();
  assert.equal(sends().length, 0, 'a comment from before the ON period was sent');
});

test('the service\'s refusals are recorded, not retried', async () => {
  await on();
  for (const [mode, reason] of [
    [{ status: 409, json: { detail: { error: 'thread_full', limit: 200 } } }, 'thread_full'],
    [{ status: 422, json: { detail: { error: 'refused_by_feedguard', reasons: ['email'] } } }, 'email'],
    [{ status: 422, json: { detail: { error: 'agent_name_refused' } } }, 'agent_name_refused'],
  ]) {
    be.st.mode = mode;
    const r = comment('ava', 'refused ' + reason);
    await cs.sweep();
    assert.equal(cs.commentStatuses()[r.id].state, 'refused', reason);
    assert.deepEqual(cs.commentStatuses()[r.id].reasons, [reason]);
  }
  be.st.mode = {};
  const gone = comment('ava', 'on a post that is gone', { post: crypto.randomUUID() });
  const before = sends().length;
  await cs.sweep();
  await cs.sweep();
  assert.equal(sends().length, before + 1, 'a refused comment was sent again');
  assert.deepEqual(cs.commentStatuses()[gone.id], { state: 'refused', agent: 'ava', post: be.st.seen.filter((x) => /\/comments$/.test(x.url)).slice(-1)[0].url.split('/')[2], agentRefused: false, reasons: ['post_gone'] });
});

test('the daily cap waits the server\'s Retry-After, then sends', async () => {
  await on();
  be.st.mode = { status: 429, json: { detail: { error: 'daily_comment_limit', limit: 20 } }, headers: { 'retry-after': '7200' } };
  const r = comment('ava', 'over the cap');
  await cs.sweep();
  assert.equal(cs.commentStatuses()[r.id].state, 'pending');
  be.st.mode = {};
  await cs.sweep();
  assert.equal(sends().length, 1, 'sent again before the Retry-After ran out');
});

test('no answer: recorded unconfirmed and never sent again (a doubled public comment is worse)', async () => {
  await on();
  be.st.mode = { hangup: true };
  const r = comment('ava', 'the answer never came');
  await cs.sweep();
  assert.equal(cs.commentStatuses()[r.id].state, 'unconfirmed');
  be.st.mode = {};
  await cs.sweep();
  await cs.sweep();
  assert.equal(sends().length, 1, 'an unconfirmed comment was sent again');
});

test('a 5xx is unconfirmed too: the server may have stored it', async () => {
  await on();
  be.st.mode = { status: 503 };
  const r = comment('ava', 'the server stumbled');
  await cs.sweep();
  assert.equal(cs.commentStatuses()[r.id].state, 'unconfirmed');
  be.st.mode = {};
  await cs.sweep();
  assert.equal(sends().length, 1);
});

test('comments keep their own record: sent.json (posts) is never written by a comment', async () => {
  await on();
  comment('ava', 'only a comment');
  await cs.sweep();
  const sent = JSON.parse(fs.readFileSync(cs._paths.sentFile(), 'utf8'));
  assert.deepEqual(sent, {}, 'a comment row reached the posts\' record, where deletes and take-downs walk');
  const csent = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  assert.equal(Object.keys(csent).length, 1);
});

test('an unreadable comments record sends no comment rather than risk sending one twice', async () => {
  await on();
  comment('ava', 'waits for a repair');
  fs.mkdirSync(path.dirname(cs._paths.commentsSentFile()), { recursive: true });
  fs.writeFileSync(cs._paths.commentsSentFile(), '{not json');
  await cs.sweep();
  assert.equal(sends().length, 0);
});

test('switched off mid-sweep: the comments after that one stay home', async () => {
  await on();
  comment('ava', 'the first comment');
  comment('ava', 'the second comment');
  // Community goes off the moment the service has stored one comment.
  cs.setSwitch(() => ({ on: be.st.comments.length === 0, ok: true }));
  await cs.sweep();
  assert.equal(sends().length, 1, 'a comment was sent after Community was switched off');
});

test('review 1: a comment held BEFORE the ON period and released during it is sent (releasedAt is the window)', async () => {
  const r = comment('bo', 'written while nobody had switched it on', { trusted: false });
  assert.equal(r.status, 'held');
  await new Promise((res) => setTimeout(res, 5));   // the ON period starts strictly after receivedAt
  await on();
  await cs.sweep();
  assert.equal(sends().length, 0, 'a held comment was sent');
  communitystore.releaseHeld(r.id);
  await cs.sweep();
  assert.equal(sends().length, 1, 'released during the ON period, it was not sent');
});

test('review 1: after a 429 the comment waits, then goes once the Retry-After has run out', async () => {
  await on();
  be.st.mode = { status: 429, json: { detail: { error: 'daily_comment_limit', limit: 20 } }, headers: { 'retry-after': '7200' } };
  const r = comment('ava', 'over the cap');
  await cs.sweep();
  be.st.mode = {};
  await cs.sweep();
  assert.equal(sends().length, 1, 'sent again before the Retry-After ran out');
  await cs.sweep(Date.now() + 7201 * 1000);
  assert.equal(sends().length, 2, 'not sent after the Retry-After ran out');
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
});

test('review 1: a POST cap does not hold comments back, and a comment cap does not touch the posts\' wait', async () => {
  await on();
  comment('ava', 'first, to register');
  await cs.sweep();
  const keysFile = cs._paths.keysFile();
  const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  keys.ava.retryAt = new Date(Date.now() + 86400000).toISOString();   // the posts' daily cap, a day away
  fs.writeFileSync(keysFile, JSON.stringify(keys));
  comment('ava', 'second, while posts wait');
  await cs.sweep();
  assert.equal(sends().length, 2, 'a post cap held a comment back');
  be.st.mode = { status: 429, json: { detail: { error: 'daily_comment_limit', limit: 20 } }, headers: { 'retry-after': '60' } };
  comment('ava', 'third, over the comment cap');
  await cs.sweep();
  const after = JSON.parse(fs.readFileSync(keysFile, 'utf8')).ava;
  assert.equal(after.retryAt, keys.ava.retryAt, 'a comment 429 changed the posts\' wait');
  assert.ok(after.commentRetryAt, 'a comment 429 set no wait for comments');
});

test('review 1: refused at the board as the service would: invisible-only, control, bidi override, links', () => {
  for (const [text, why] of [
    ['​​', /empty/],
    ['hello\u0000there', /control character/],
    ['look ‮ereh', /bidirectional override/],
  ]) {
    const r = comment('ava', text);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.match(r.error, why);
  }
  communitystore.grantTrust('ava');
  const withLinks = feedpublish.publishServiceComment({ kind: 'community_post', agent: 'ava', at: 'x', body: 'see this', links: ['https://example.com'], servicePostId: POST }, { agentId: 'ava' });
  assert.equal(withLinks.ok, false);
  assert.match(withLinks.error, /text only/);
  assert.equal(comment('ava', 'right-to-left marks stay ‏ fine').ok, true, 'a plain RTL mark was refused');
  assert.equal(communitystore.moderationQueue().length, 0);
});

test('review 2: a character Unicode 17 added is refused, since the service\'s Unicode 16 cannot check it', () => {
  for (const ch of ['꟱', '࢏', '\u{1FAEA}', '\u{323B0}']) {
    const r = comment('ava', 'hello ' + ch);
    assert.equal(r.ok, false, 'U+' + ch.codePointAt(0).toString(16));
    assert.match(r.error, /cannot check yet/);
  }
  assert.equal(comment('ava', 'hello \u{1FAE9}').ok, true, 'a character both versions know was refused');
});

test('review 2: TRIPWIRE: this board\'s Unicode is the one the list above was generated against', () => {
  // The refused set is { the service's Unicode 16 Cn } minus { Node 17 \p{Cn} }. On a newer Node, characters it
  // newly assigns pass \p{Cn} here and the service still refuses them: regenerate the list in engine/feedpublish.js.
  assert.equal(String(process.versions.unicode).split('.')[0], '17', 'Node moved past Unicode 17: regenerate NEWER_THAN_SERVICE');
});

test('review 2: the service\'s list-shaped validation 422 is recorded as a fixed class, not its text', async () => {
  await on();
  be.st.mode = { status: 422, json: { detail: [{ type: 'value_error', msg: 'Value error, text contains a character this server cannot check yet', input: 'secret words' }] } };
  const r = comment('ava', 'refused by validation');
  await cs.sweep();
  assert.deepEqual(cs.commentStatuses()[r.id].reasons, ['invalid_text']);
  assert.ok(!fs.readFileSync(cs._paths.commentsSentFile(), 'utf8').includes('secret words'), 'the server\'s echo was stored');
});

test('review 3: an expired token is renewed and the comment POSTed again, and the service stores it ONCE', async () => {
  await on();
  comment('ava', 'first, to register');
  await cs.sweep();
  const agent = [...be.st.agents.values()][0];
  agent.token = 'expired-on-the-server';          // the board's token no longer answers
  const r = comment('ava', 'after the token expired');
  await cs.sweep();
  assert.equal(be.st.seen.filter((x) => x.url === '/agents/login').length, 1, 'the board did not log in again');
  assert.equal(be.st.comments.filter((c) => c.body === 'after the token expired').length, 1, 'stored twice, or not at all');
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
});

test('review 4: a comment made in the minutes before the first sweep of an ON period is inside the window when willSend said so', async () => {
  SW = { on: true, ok: true };                          // Community on, but no sweep has recorded when yet
  assert.equal(cs.willSend('ava').sends, true);         // records the period's start now
  const r = comment('ava', 'before the first sweep');
  await cs.sweep();
  assert.equal(sends().length, 1, 'a comment the agent was told would go never went');
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
});

test('review 4: willSend is false with the switch off, an unreadable state, or a refused agent', () => {
  SW = { on: false, ok: true };
  assert.equal(cs.willSend('ava').sends, false);
  SW = { on: true, ok: true };
  fs.mkdirSync(path.dirname(cs._paths.stateFile()), { recursive: true });
  fs.writeFileSync(cs._paths.stateFile(), '{not json');
  assert.equal(cs.willSend('ava').sends, false);
  fs.rmSync(cs._paths.stateFile());
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ ava: { refused: true } }));
  assert.equal(cs.willSend('ava').sends, false);
  assert.equal(cs.willSend('bo').sends, true);
});

test('#4939 review 7: an agent whose community name is held (no key yet) is told its post goes later, not shortly', () => {
  SW = { on: true, ok: true };
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ ava: { registering: { taken: true } }, bo: { apiKey: 'k', registering: { taken: true } } }));
  assert.deepEqual(cs.willSend('ava', Date.now(), 'post'), { sends: true, later: true }, 'a held name read as sending on the next pass');
  assert.deepEqual(cs.willSend('ava', Date.now(), 'comment'), { sends: true, later: true });
  assert.deepEqual(cs.willSend('bo', Date.now(), 'post'), { sends: true, later: false }, 'CONTROL: an agent with its key is not held');
});

test('review 5: FIRST WRITER WINS: a sweep holding an old copy of the state cannot move the period\'s start later', async () => {
  await on();
  comment('ava', 'first, to register the agent for real');
  await cs.sweep();
  fs.writeFileSync(cs._paths.stateFile(), '{}');      // a new ON period: no start recorded yet
  // A slow first sweep: the service holds every request, so the sweep waits with its copy of the (empty) state.
  let release;
  const gate = new Promise((res) => { release = res; });
  cs.setSender(async (url, init) => { await gate; return fetch(url, init); });
  // An unconfirmed post (a real published one, so the settle pass asks the service about it) makes the sweep wait on
  // the network BEFORE it reads its window.
  const post = feedpublish.publishPost({ kind: 'community_post', agent: 'ava', at: new Date().toISOString(), topic: 't', body: 'an unconfirmed post' }, { agentId: 'ava' });
  assert.equal(post.status, 'published');
  const sentFile = cs._paths.sentFile();
  const sentNow = JSON.parse(fs.readFileSync(sentFile, 'utf8'));
  sentNow[post.id] = { state: 'pending', agent: 'ava', attempted: true };
  fs.writeFileSync(sentFile, JSON.stringify(sentNow));
  const before = be.st.seen.length;
  const sweeping = cs.sweep();
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(be.st.seen.length, before, 'control: the sweep is held at the service, not finished');
  assert.equal(cs.willSend('ava').sends, true);        // records the start while the sweep waits
  const recorded = JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8')).since;
  const r = comment('ava', 'made while the first sweep waited');
  await new Promise((res) => setTimeout(res, 20));
  release();
  await sweeping;
  assert.equal(JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8')).since, recorded, 'the sweep moved the start later');
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  assert.equal(cs.commentStatuses()[r.id] && cs.commentStatuses()[r.id].state, 'sent', 'a comment the agent was told would go never went');
});

test('review 5: a published comment the agent was told "will not go" never goes, even once Community is on again', async () => {
  await on();
  SW = { on: false, ok: true };
  const r = comment('ava', 'made while off');
  assert.equal(cs.willSend('ava').sends, false);
  assert.equal(cs.markNotSent(r.id, 'ava'), true);
  SW = { on: true, ok: true };                          // on again before any sweep saw it off: the old start stands
  await cs.sweep();
  await cs.sweep();
  assert.equal(sends().length, 0, 'a comment the agent was told would not go, went');
  assert.equal(cs.commentStatuses()[r.id].state, 'not_sent');
});

test('review 5: past the daily comment cap, willSend says it goes LATER, not on the next pass', async () => {
  await on();
  comment('ava', 'first, to register');
  await cs.sweep();
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  keys.ava.commentRetryAt = new Date(Date.now() + 3600000).toISOString();
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(keys));
  assert.deepEqual(cs.willSend('ava'), { sends: true, later: true });
  assert.deepEqual(cs.willSend('bo'), { sends: true, later: false });
});

test('review 6: a "will not go" mark made while a sweep is sending survives that sweep\'s save, and the comment never goes', async () => {
  await on();
  comment('ava', 'first, to register');
  await cs.sweep();
  comment('ava', 'the one in flight');
  let release;
  const gate = new Promise((res) => { release = res; });
  cs.setSender(async (url, init) => { await gate; return fetch(url, init); });
  const before = be.st.seen.length;
  const sweeping = cs.sweep();                          // holds its copy of comments-sent.json across the wait
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(be.st.seen.length, before, 'control: the sweep is held at the service');
  const r = comment('ava', 'told it will not go');
  assert.equal(r.status, 'published');
  assert.equal(cs.markNotSent(r.id, 'ava', POST), true);
  release();
  await sweeping;                                       // its save rewrites comments-sent.json from its old copy
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  await cs.sweep();
  assert.equal(be.st.comments.filter((c) => c.body === 'told it will not go').length, 0, 'a comment the agent was told would not go, went');
});

async function inFlight(flip) {
  await on();
  comment('ava', 'first, to register');
  await cs.sweep();
  comment('ava', 'A');
  comment('ava', 'B');
  let release;
  const gate = new Promise((res) => { release = res; });
  cs.setSender(async (url, init) => { await gate; return fetch(url, init); });
  const before = be.st.seen.length;
  const sweeping = cs.sweep();
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(be.st.seen.length, before, 'control: the sweep is held at the service');
  if (flip) {
    SW = { on: false, ok: true };
    cs.endOnPeriodNow();
    await new Promise((res) => setTimeout(res, 5));
    SW = { on: true, ok: true };
    assert.equal(cs.recordPeriodStart(), true, 'a new ON period started');
  }
  release();
  await sweeping;
  return be.st.comments.filter((c) => c.body === 'B').length;
}

test('review (in flight): a sweep sending across an OFF then ON sends nothing more from the old ON period', async () => {
  assert.equal(await inFlight(true), 0, 'a comment from the ended ON period went out after it ended');
});

test('review (in flight): CONTROL: with no OFF, the same held sweep sends the second comment', async () => {
  assert.equal(await inFlight(false), 1);
});

/* #4939 review 3: the POST pass too. Status says a post from an ended ON period "will not be sent, post it again", so a
   sweep that began before an OFF then ON must not send it, as the comment pass already does not. */
async function postsInFlight(flip) {
  await on();
  const pub = (topic) => { communitystore.grantTrust('ava'); const r = feedpublish.publishPost({ kind: 'community_post', agent: 'ava', at: new Date().toISOString(), topic, body: topic + ' body.' }, { agentId: 'ava' }); assert.equal(r.ok, true, JSON.stringify(r)); };
  pub('first, to register');
  await cs.sweep();
  pub('P1');
  pub('P2');
  let release;
  const gate = new Promise((res) => { release = res; });
  cs.setSender(async (url, init) => { await gate; return fetch(url, init); });
  const sweeping = cs.sweep();
  await new Promise((res) => setTimeout(res, 50));
  if (flip) {
    SW = { on: false, ok: true };
    cs.endOnPeriodNow();
    await new Promise((res) => setTimeout(res, 5));
    SW = { on: true, ok: true };
    assert.equal(cs.recordPeriodStart(), true, 'a new ON period started');
  }
  release();
  await sweeping;
  return (be.st.posts || []).filter((x) => x.title === 'P2').length;
}
test('#4939 review 3 (in flight): a post sweep across an OFF then ON sends nothing more from the old ON period', async () => {
  assert.equal(await postsInFlight(true), 0, 'a post from the ended ON period went out after it ended');
});
test('#4939 review 3 (in flight): CONTROL: with no OFF, the same held post sweep sends the second post', async () => {
  assert.equal(await postsInFlight(false), 1);
});

/* #4939 review 4: a first-time agent is registered INSIDE sendPost/sendComment, which can take many seconds; switching
   off meanwhile must stop the send, as status already says it will not go. The request is held at /agents/register. */
async function heldAtRegister(kind, flip) {
  await on();
  let localId = null;
  if (kind === 'post') {
    communitystore.grantTrust('ava');
    const r = feedpublish.publishPost({ kind: 'community_post', agent: 'ava', at: new Date().toISOString(), topic: 'R1', body: 'R1 body.' }, { agentId: 'ava' });
    assert.equal(r.ok, true, JSON.stringify(r));
    localId = r.id;
  } else comment('ava', 'R1');
  let release;
  const gate = new Promise((res) => { release = res; });
  let reached = false;
  cs.setSender(async (url, init) => { if (/\/agents\/register$/.test(url)) { reached = true; await gate; } return fetch(url, init); });
  const sweeping = cs.sweep();
  for (let i = 0; i < 100 && !reached; i++) await new Promise((res) => setTimeout(res, 10));
  assert.equal(reached, true, 'control: the sweep reached registration');
  if (flip === 'delete') assert.equal(cs.requestDelete(localId).ok, true, 'fixture: the delete was not recorded');
  else if (flip) { SW = { on: false, ok: true }; cs.endOnPeriodNow(); }
  release();
  await sweeping;
  return kind === 'post' ? (be.st.posts || []).filter((x) => x.title === 'R1').length : be.st.comments.filter((c) => c.body === 'R1').length;
}
test('#4939 review 4 (registering): switched off while a first post\'s agent registers, the post does not go', async () => {
  assert.equal(await heldAtRegister('post', true), 0, 'a post went out after Community was switched off');
});
test('#4939 review 4 (registering): switched off while a first comment\'s agent registers, the comment does not go', async () => {
  assert.equal(await heldAtRegister('comment', true), 0, 'a comment went out after Community was switched off');
});
test('#4939 review 4 (registering): a post the owner removed while its agent registered does not go', async () => {
  assert.equal(await heldAtRegister('post', 'delete'), 0, 'a post the owner removed went out');
});
test('#4939 review 4 (registering): CONTROL: with no OFF, the post and the comment go', async () => {
  assert.equal(await heldAtRegister('post', false), 1);
});
test('#4939 review 4 (registering): CONTROL: with no OFF, the comment goes', async () => {
  assert.equal(await heldAtRegister('comment', false), 1);
});

test('review 6: willSend is false while a file the sweep needs is unreadable', async () => {
  await on();
  SW = { on: true, ok: true };
  for (const f of [cs._paths.sentFile(), cs._paths.deletesFile(), cs._paths.commentsSentFile()]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const had = fs.existsSync(f) ? fs.readFileSync(f) : null;
    fs.writeFileSync(f, '{not json');
    assert.equal(cs.willSend('ava').sends, false, path.basename(f));
    if (had) fs.writeFileSync(f, had); else fs.rmSync(f);
  }
  assert.equal(cs.willSend('ava').sends, true, 'control: with every file readable it sends');
});

test('review 7: a held comment released in the minutes before the first sweep of an ON period is sent', async () => {
  const r = comment('bo', 'held, then released before any sweep', { trusted: false });
  await new Promise((res) => setTimeout(res, 5));
  SW = { on: true, ok: true };                          // Community on; no sweep has recorded the period's start
  assert.equal(cs.recordPeriodStart(), true);           // what the release route does first
  communitystore.releaseHeld(r.id);
  await new Promise((res) => setTimeout(res, 5));
  await cs.sweep();                                     // the first sweep: its start must not be after the release
  assert.equal(sends().length, 1, 'the released comment never went');
});

test('review 7: recordPeriodStart records nothing while Community is off', () => {
  SW = { on: false, ok: true };
  assert.equal(cs.recordPeriodStart(), false);
  assert.ok(!fs.existsSync(cs._paths.stateFile()) || !JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8')).since);
});

test('review 9: recordPeriodStart records nothing for an address the sweep will not send to', () => {
  SW = { on: true, ok: true };
  const was = process.env.AGENT_WORKFORCE_COMMUNITY_URL;
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://community.example.com/';   // plain http, not local
  try {
    assert.equal(cs.recordPeriodStart(), false);
    assert.ok(!fs.existsSync(cs._paths.stateFile()) || !JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8')).since, 'a start was recorded for an address the sweep refuses');
  } finally { process.env.AGENT_WORKFORCE_COMMUNITY_URL = was; }
  assert.equal(cs.recordPeriodStart(), true, 'control: the loopback address records a start');
});

/* #4947's postLater and postWaits were folded into willSend(.., 'post') by #4939, which the post route asks; these ask
   it the same questions. */
test('#4947: willSend(post).later says whether this agent\'s next post waits past the daily post cap (and only that agent\'s)', () => {
  fresh();
  SW = { on: true, ok: true };
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  const now = Date.now();
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({
    ava: { retryAt: new Date(now + 3600000).toISOString() },             // capped for the next hour
    bo: { retryAt: new Date(now - 60000).toISOString() },                // the wait is over
    cy: { commentRetryAt: new Date(now + 3600000).toISOString() },       // a COMMENT cap does not hold posts
  }));
  assert.equal(cs.willSend('ava', now, 'post').later, true, 'a capped agent\'s post was not said to wait');
  assert.equal(cs.willSend('bo', now, 'post').later, false);
  assert.equal(cs.willSend('cy', now, 'post').later, false, 'a comment cap was taken for a post cap');
  assert.equal(cs.willSend('nobody', now, 'post').later, false);
  fs.writeFileSync(cs._paths.keysFile(), '{not json');
  assert.equal(cs.willSend('ava', now, 'post').later, false, 'unreadable state promised a wait');
});

test('#4947: willSend(post) promises "once the cap lifts" only for a post that will be sent at all', () => {
  const waits = (k, now) => { const w = cs.willSend(k, now, 'post'); return w.sends && w.later; };
  fresh();
  SW = { on: true, ok: true };
  const now = Date.now();
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ ava: { retryAt: new Date(now + 3600000).toISOString() }, bo: { retryAt: new Date(now + 3600000).toISOString(), refused: true } }));
  assert.equal(waits('ava', now), true, 'control: on, capped, will be sent');
  assert.equal(waits('bo', now), false, 'a refused key was promised a send once the cap lifts');
  SW = { on: false, ok: true };
  assert.equal(waits('ava', now), false, 'with Community off a post was promised a send once the cap lifts');
});

test('#4947: asking willSend(post) (the post route does, before the store) records the ON period\'s start, as a comment\'s willSend does', () => {
  /* So a post made in the minutes before the first sweep of an ON period is inside the window and sent: a change in what
     gets sent (written under Decided in the plan), and it holds for a post the safety check holds too (that one is not
     due until it is released, so the earlier start costs nothing). */
  fresh();
  SW = { on: true, ok: true };
  const stateFile = cs._paths.stateFile();
  const before = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).since : undefined;
  assert.equal(before, undefined, 'fixture: no sweep has recorded the period\'s start yet');
  cs.willSend('ava', Date.now(), 'post');
  assert.equal(typeof JSON.parse(fs.readFileSync(stateFile, 'utf8')).since, 'string', 'the post route\'s question did not record the period\'s start');
});

test('#4940: a register 429 asking for an hour waits at most five minutes, so the agent\'s comment goes soon after', async () => {
  await on();
  comment('ava', 'Joining in.');
  cs.setSender(async (url, init) => (String(url).endsWith('/agents/register')
    ? { status: 429, ok: false, headers: new Headers({ 'retry-after': '3600' }), text: async () => '{}', json: async () => ({}) }
    : fetch(url, init)));
  const before = Date.now();
  await cs.sweep();
  const at = cs._registerRetryAt('ava');
  assert.ok(at, 'the 429 was not recorded as a wait');
  assert.ok(at - before <= cs.REGISTER_429_WAIT_MAX_S * 1000 + 5000, 'the wait followed the hour asked: ' + (at - before) + ' ms');
  assert.ok(at - before >= 59 * 1000, 'CONTROL: it still waits (at least a minute), never a busy loop');
  // Review 1: what the agent is told while it waits is true, says to run it again, and ends with no period (the CLI adds one).
  const r = await cs.agentCall('ava', 'POST', '/agents/by-name/x/follow', {});
  assert.equal(r.ok, false);
  assert.match(r.because, /^this agent is still waiting to join the community, and Kosmos asks again in about five minutes; run this again then \(what it has queued is kept, not lost; kosmos community status says what will go\)$/);
});

test('#4940 review 2: a registration that fails with no wait set (a server error) says it is tried on the next pass', async () => {
  await on();
  cs.setSender(async (url, init) => (String(url).endsWith('/agents/register')
    ? { status: 500, ok: false, headers: new Headers(), text: async () => '{}', json: async () => ({}) }
    : fetch(url, init)));
  const r = await cs.agentCall('zed', 'POST', '/agents/by-name/x/follow', {});
  assert.equal(r.ok, false);
  assert.match(r.because, /^the community could not register this agent just now, and Kosmos tries again on its next pass; run this again in a few minutes \(what it has queued is kept, not lost; kosmos community status says what will go\)$/);
});
